// Coverage for the recordings pipeline: the duration pre-check, the
// post-transcription junk guard, the happy path's writes, and per-row
// failure isolation in the batch runner. Every external dependency (GHL,
// Deepgram, Claude, the outcome matcher) is mocked — no live calls. Mocking
// style mirrors src/lib/transcripts/process.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const getContactMock = vi.fn();
vi.mock('../ghl/client', () => ({
  getContact: (...args: unknown[]) => getContactMock(...args),
}));

const downloadRecordingAudioMock = vi.fn();
const getGhlUserEmailMock = vi.fn();
vi.mock('../ghl/recordings', () => ({
  downloadRecordingAudio: (...args: unknown[]) => downloadRecordingAudioMock(...args),
  getGhlUserEmail: (...args: unknown[]) => getGhlUserEmailMock(...args),
}));

let deepgramConfigured = true;
const transcribeRecordingMock = vi.fn();
vi.mock('../deepgram', () => ({
  isDeepgramConfigured: () => deepgramConfigured,
  transcribeRecording: (...args: unknown[]) => transcribeRecordingMock(...args),
}));

let claudeConfigured = true;
vi.mock('../claude', () => ({
  isClaudeConfigured: () => claudeConfigured,
}));

const extractLearningsMock = vi.fn();
vi.mock('../transcripts/extract', () => ({
  extractLearnings: (...args: unknown[]) => extractLearningsMock(...args),
}));

const matchRecordingOutcomeMock = vi.fn();
vi.mock('./outcomes', () => ({
  matchRecordingOutcome: (...args: unknown[]) => matchRecordingOutcomeMock(...args),
}));

import { claimRecording, processOneRecording, processPendingRecordings } from './pipeline';

const sampleLearnings = {
  objections: [],
  customer_language: [],
  what_worked: [],
  what_failed: [],
  price_talk: [],
  questions: [],
  summary: 'summary',
};

type RowState = { status: string; processing_at: string | null };

type Row = {
  id: string;
  ghl_message_id: string | null;
  ghl_contact_id: string | null;
  ghl_user_id: string | null;
  direction: string | null;
  called_at: string | null;
  duration_seconds: number | null;
  status: string;
  processing_at: string | null;
};

function baseRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'r1',
    ghl_message_id: 'm1',
    ghl_contact_id: 'c1',
    ghl_user_id: 'u1',
    direction: 'inbound',
    called_at: '2026-07-10T12:00:00.000Z',
    duration_seconds: 120,
    status: 'pending',
    processing_at: null,
    ...overrides,
  };
}

// Fake Supabase client covering the tables pipeline.ts touches:
// call_recordings (select for the batch, update for status writes and for
// the claim compare-and-swap), verticals (the holiday vertical lookup),
// transcripts (insert), and learnings (upsert).
//
// `rowState` is an OPTIONAL shared, mutable map standing in for the real
// row's live status/processing_at in the database. When two fakeSupabase
// clients are given the SAME rowState map (see the concurrent-claim tests
// below), a claim performed through one client is visible to the other,
// modeling the real compare-and-swap race. When omitted (every existing
// test that predates the claim step), every claim attempt trivially
// succeeds so those tests are unaffected by the new claim-before-process
// step.
function fakeSupabase(
  opts: {
    pendingRows?: Row[];
    vertical?: { id: string; name: string } | null;
    transcriptInsertError?: { message: string } | null;
    rowState?: Map<string, RowState>;
    insertCallsSink?: Record<string, unknown>[];
  } = {},
) {
  const updateCalls: { id: string; patch: Record<string, unknown> }[] = [];
  const insertCalls = opts.insertCallsSink ?? [];
  const upsertCalls: { row: Record<string, unknown>; options?: Record<string, unknown> }[] = [];

  const from = vi.fn((table: string) => {
    if (table === 'call_recordings') {
      return {
        select: () => ({
          or: () => ({
            order: () => ({
              limit: async () => ({ data: opts.pendingRows ?? [], error: null }),
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => {
          const filters: { id?: string; status?: string; processingAtLt?: string } = {};
          const builder = {
            eq(column: string, value: string) {
              if (column === 'id') filters.id = value;
              if (column === 'status') filters.status = value;
              return builder;
            },
            lt(column: string, value: string) {
              if (column === 'processing_at') filters.processingAtLt = value;
              return builder;
            },
            // The claimRecording() shape: two .eq()s (or one .eq() + one
            // .lt()) then .select() -- resolved as a genuine compare-and-
            // swap against rowState when one was provided.
            select: async () => {
              const id = filters.id!;
              updateCalls.push({ id, patch });
              if (!opts.rowState) return { data: [{ id }], error: null };
              const current = opts.rowState.get(id);
              let matches = !!current;
              if (matches && filters.status !== undefined) matches = current!.status === filters.status;
              if (matches && filters.processingAtLt !== undefined) {
                matches = current!.processing_at != null && current!.processing_at < filters.processingAtLt;
              }
              if (matches) opts.rowState.set(id, { ...current!, ...(patch as Partial<RowState>) });
              return matches ? { data: [{ id }], error: null } : { data: [], error: null };
            },
            // The markRow() shape: a single .eq('id', id) awaited directly,
            // no status filter, no .select() -- always applies (the row is
            // already owned by this invocation by the time markRow runs).
            then(resolve: (v: { error: null }) => void) {
              const id = filters.id!;
              updateCalls.push({ id, patch });
              if (opts.rowState) {
                const current = opts.rowState.get(id) ?? { status: 'pending', processing_at: null };
                opts.rowState.set(id, { ...current, ...(patch as Partial<RowState>) });
              }
              resolve({ error: null });
            },
          };
          return builder;
        },
      };
    }
    if (table === 'verticals') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: opts.vertical ?? { id: 'v1', name: 'Holiday' }, error: null }),
          }),
        }),
      };
    }
    if (table === 'transcripts') {
      return {
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              insertCalls.push(row);
              if (opts.transcriptInsertError) return { data: null, error: opts.transcriptInsertError };
              return { data: { id: 'tr1' }, error: null };
            },
          }),
        }),
      };
    }
    if (table === 'learnings') {
      return {
        upsert: (row: Record<string, unknown>, options?: Record<string, unknown>) => {
          upsertCalls.push({ row, options });
          return Promise.resolve({ error: null });
        },
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return { client: { from } as unknown as SupabaseClient, updateCalls, insertCalls, upsertCalls };
}

const HOLIDAY_VERTICAL = { id: 'v1', name: 'Holiday' };

describe('processOneRecording', () => {
  beforeEach(() => {
    deepgramConfigured = true;
    claudeConfigured = true;
    getContactMock.mockReset().mockResolvedValue({ phone: '5551234567', email: 'jamie@example.com', fullName: 'Jamie Lee' });
    downloadRecordingAudioMock.mockReset().mockResolvedValue(Buffer.from('fake-audio'));
    getGhlUserEmailMock.mockReset().mockResolvedValue('rep@yulelovelights.com');
    transcribeRecordingMock.mockReset().mockResolvedValue({
      rawText: 'Speaker 0: hi there this is a real conversation about holiday lights for your home this season.\n\nSpeaker 1: great, tell me more about pricing and scheduling please.',
      utterances: [
        { speaker: 0, start: 0, end: 3, text: 'hi there this is a real conversation about holiday lights for your home this season' },
        { speaker: 1, start: 3, end: 6, text: 'great, tell me more about pricing and scheduling please' },
      ],
      durationSeconds: 120,
    });
    extractLearningsMock.mockReset().mockResolvedValue(sampleLearnings);
    matchRecordingOutcomeMock.mockReset().mockResolvedValue({ outcome: 'unknown', outcome_source: null });
  });

  it('skips recordings shorter than 20 seconds without downloading or transcribing', async () => {
    const { client, updateCalls } = fakeSupabase();
    const row = baseRow({ duration_seconds: 10 });

    const result = await processOneRecording(client, row, HOLIDAY_VERTICAL);

    expect(result).toBe('skipped');
    expect(downloadRecordingAudioMock).not.toHaveBeenCalled();
    expect(transcribeRecordingMock).not.toHaveBeenCalled();
    expect(updateCalls).toEqual([{ id: 'r1', patch: { status: 'skipped', skip_reason: 'duration_under_20s' } }]);
  });

  it('fails immediately with no ghl_message_id', async () => {
    const { client, updateCalls } = fakeSupabase();
    const row = baseRow({ ghl_message_id: null });

    const result = await processOneRecording(client, row, HOLIDAY_VERTICAL);

    expect(result).toBe('failed');
    expect(downloadRecordingAudioMock).not.toHaveBeenCalled();
    expect(updateCalls[0].patch.status).toBe('failed');
  });

  it('fails without downloading when Deepgram is not configured', async () => {
    deepgramConfigured = false;
    const { client } = fakeSupabase();

    const result = await processOneRecording(client, baseRow(), HOLIDAY_VERTICAL);

    expect(result).toBe('failed');
    expect(downloadRecordingAudioMock).not.toHaveBeenCalled();
  });

  it('skips a transcribed call the junk detector rejects (e.g. single-speaker voicemail)', async () => {
    transcribeRecordingMock.mockResolvedValueOnce({
      rawText: 'Speaker 0: please leave a message after the tone.',
      utterances: [{ speaker: 0, start: 0, end: 2, text: 'please leave a message after the tone' }],
      durationSeconds: 30,
    });
    const { client, updateCalls } = fakeSupabase();

    const result = await processOneRecording(client, baseRow(), HOLIDAY_VERTICAL);

    expect(result).toBe('skipped');
    expect(updateCalls).toEqual([{ id: 'r1', patch: { status: 'skipped', skip_reason: 'single_speaker' } }]);
    expect(extractLearningsMock).not.toHaveBeenCalled();
  });

  it('transcribes a real call end to end: inserts the transcript, extracts learnings, marks the row transcribed', async () => {
    matchRecordingOutcomeMock.mockResolvedValueOnce({ outcome: 'booked', outcome_source: 'quote_tool' });
    const { client, updateCalls, insertCalls, upsertCalls } = fakeSupabase();

    const result = await processOneRecording(client, baseRow(), HOLIDAY_VERTICAL);

    expect(result).toBe('transcribed');
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toMatchObject({
      vertical_id: 'v1',
      source_file: 'ghl:m1',
      customer_phone: '5551234567',
      customer_name: 'Jamie Lee',
      outcome: 'booked',
      outcome_source: 'quote_tool',
      ghl_contact_id: 'c1',
      metric_scope: 'performance',
      rep_email: 'rep@yulelovelights.com',
      direction: 'inbound',
      duration_seconds: 120,
    });
    expect(upsertCalls).toEqual([
      { row: expect.objectContaining({ transcript_id: 'tr1', vertical_id: 'v1' }), options: { onConflict: 'transcript_id' } },
    ]);
    expect(updateCalls).toEqual([{ id: 'r1', patch: { status: 'transcribed', transcript_id: 'tr1' } }]);
  });

  it('rounds a fractional Deepgram duration to an integer for the transcripts insert', async () => {
    // Regression: Deepgram reports fractional seconds (96.23994 on the first
    // live run) and transcripts.duration_seconds is an int column -- the raw
    // float made Postgres reject the whole insert with 22P02.
    transcribeRecordingMock.mockResolvedValueOnce({
      rawText: 'Speaker 0: hi there this is a real conversation about holiday lights for your home this season.\n\nSpeaker 1: great, tell me more about pricing and scheduling please.',
      utterances: [
        { speaker: 0, start: 0, end: 3, text: 'hi there this is a real conversation about holiday lights for your home this season' },
        { speaker: 1, start: 3, end: 6, text: 'great, tell me more about pricing and scheduling please' },
      ],
      durationSeconds: 96.23994,
    });
    const { client, insertCalls } = fakeSupabase();

    const result = await processOneRecording(client, baseRow(), HOLIDAY_VERTICAL);

    expect(result).toBe('transcribed');
    expect(insertCalls[0].duration_seconds).toBe(96);
  });

  it('stores a readable error detail when a thrown failure is a plain object, not an Error', async () => {
    // Regression: the first live failures stored "[object Object]" because
    // String() was applied to a thrown Supabase error object.
    downloadRecordingAudioMock.mockRejectedValueOnce({ code: '22P02', message: 'invalid input syntax for type integer: "96.23994"' });
    const { client, updateCalls } = fakeSupabase();

    const result = await processOneRecording(client, baseRow(), HOLIDAY_VERTICAL);

    expect(result).toBe('failed');
    const detail = updateCalls[0].patch.detail as { error: string };
    expect(detail.error).toContain('22P02');
    expect(detail.error).not.toBe('[object Object]');
  });

  it('still marks the recording transcribed when learnings extraction fails (best-effort)', async () => {
    extractLearningsMock.mockRejectedValueOnce(new Error('Claude overloaded'));
    const { client, updateCalls } = fakeSupabase();

    const result = await processOneRecording(client, baseRow(), HOLIDAY_VERTICAL);

    expect(result).toBe('transcribed');
    expect(updateCalls).toEqual([{ id: 'r1', patch: { status: 'transcribed', transcript_id: 'tr1' } }]);
  });

  it('marks the row failed with an error detail when the download throws', async () => {
    downloadRecordingAudioMock.mockRejectedValueOnce(new Error('GHL 404'));
    const { client, updateCalls } = fakeSupabase();

    const result = await processOneRecording(client, baseRow(), HOLIDAY_VERTICAL);

    expect(result).toBe('failed');
    expect(updateCalls).toEqual([{ id: 'r1', patch: { status: 'failed', detail: { error: 'GHL 404' } } }]);
  });

  it('degrades rep_email and contact fields to null on a GHL contact hydrate failure, without failing the recording', async () => {
    getContactMock.mockRejectedValueOnce(new Error('contact not found'));
    const { client, insertCalls } = fakeSupabase();

    const result = await processOneRecording(client, baseRow(), HOLIDAY_VERTICAL);

    expect(result).toBe('transcribed');
    expect(insertCalls[0]).toMatchObject({ customer_phone: null, customer_name: null });
  });
});

describe('processPendingRecordings', () => {
  beforeEach(() => {
    deepgramConfigured = true;
    claudeConfigured = true;
    getContactMock.mockReset().mockResolvedValue({ phone: null, email: null, fullName: null });
    getGhlUserEmailMock.mockReset().mockResolvedValue(null);
    matchRecordingOutcomeMock.mockReset().mockResolvedValue({ outcome: 'unknown', outcome_source: null });
    extractLearningsMock.mockReset().mockResolvedValue(sampleLearnings);
    downloadRecordingAudioMock.mockReset();
    transcribeRecordingMock.mockReset();
  });

  it('returns all-zero counts with no pending rows and never resolves the vertical', async () => {
    const { client } = fakeSupabase({ pendingRows: [] });

    const result = await processPendingRecordings(client, 6);

    expect(result).toEqual({ done: 0, skipped: 0, failed: 0 });
  });

  it('processes each pending row independently: one failure does not stop the rest', async () => {
    downloadRecordingAudioMock
      .mockRejectedValueOnce(new Error('GHL down')) // r1 fails
      .mockResolvedValueOnce(Buffer.from('audio')); // r2 succeeds
    transcribeRecordingMock.mockResolvedValueOnce({
      rawText: 'Speaker 0: hello and welcome to yule love lights how can I help you today with your display.\n\nSpeaker 1: I would like a quote for my house please.',
      utterances: [
        { speaker: 0, start: 0, end: 3, text: 'hello and welcome to yule love lights how can I help you today with your display' },
        { speaker: 1, start: 3, end: 6, text: 'I would like a quote for my house please' },
      ],
      durationSeconds: 90,
    });

    const rows: Row[] = [baseRow({ id: 'r1' }), baseRow({ id: 'r2' })];
    const { client } = fakeSupabase({ pendingRows: rows });

    const result = await processPendingRecordings(client, 6);

    expect(result).toEqual({ done: 1, skipped: 0, failed: 1 });
  });

  it('a second concurrent batch skips a row the first already claimed, and never double-transcribes it', async () => {
    downloadRecordingAudioMock.mockResolvedValue(Buffer.from('audio'));
    transcribeRecordingMock.mockResolvedValue({
      rawText: 'Speaker 0: hello and welcome to yule love lights how can I help you today with your display.\n\nSpeaker 1: I would like a quote for my house please.',
      utterances: [
        { speaker: 0, start: 0, end: 3, text: 'hello and welcome to yule love lights how can I help you today with your display' },
        { speaker: 1, start: 3, end: 6, text: 'I would like a quote for my house please' },
      ],
      durationSeconds: 90,
    });

    // Both "batches" (the nightly cron racing a staff click, or two staff
    // clicks) select the SAME pending row before either has claimed it --
    // rowState is the one thing they share, standing in for the real table.
    const rows: Row[] = [baseRow({ id: 'r1' })];
    const rowState = new Map<string, RowState>([['r1', { status: 'pending', processing_at: null }]]);
    const sharedInsertCalls: Record<string, unknown>[] = [];

    const clientA = fakeSupabase({ pendingRows: rows, rowState, insertCallsSink: sharedInsertCalls }).client;
    const clientB = fakeSupabase({ pendingRows: rows, rowState, insertCallsSink: sharedInsertCalls }).client;

    const [resultA, resultB] = await Promise.all([processPendingRecordings(clientA, 6), processPendingRecordings(clientB, 6)]);

    // Exactly one batch wins the claim and transcribes the row; the other
    // finds it already claimed and skips it without counting it any way --
    // never both (double spend) and never neither (row starved).
    expect(resultA.done + resultB.done).toBe(1);
    expect(resultA.skipped + resultB.skipped).toBe(0);
    expect(resultA.failed + resultB.failed).toBe(0);
    expect(sharedInsertCalls).toHaveLength(1);
    expect(rowState.get('r1')?.status).toBe('transcribed');
  });

  it('reclaims and fully processes a candidate row left abandoned in processing (crashed invocation)', async () => {
    downloadRecordingAudioMock.mockResolvedValue(Buffer.from('audio'));
    transcribeRecordingMock.mockResolvedValue({
      rawText: 'Speaker 0: hello and welcome to yule love lights how can I help you today with your display.\n\nSpeaker 1: I would like a quote for my house please.',
      utterances: [
        { speaker: 0, start: 0, end: 3, text: 'hello and welcome to yule love lights how can I help you today with your display' },
        { speaker: 1, start: 3, end: 6, text: 'I would like a quote for my house please' },
      ],
      durationSeconds: 90,
    });

    const staleRow = baseRow({ id: 'r1', status: 'processing', processing_at: '2026-07-14T11:00:00.000Z' }); // 60 min old
    const rowState = new Map<string, RowState>([['r1', { status: 'processing', processing_at: '2026-07-14T11:00:00.000Z' }]]);
    const { client } = fakeSupabase({ pendingRows: [staleRow], rowState });

    const result = await processPendingRecordings(client, 6, new Date('2026-07-14T12:00:00.000Z'));

    expect(result).toEqual({ done: 1, skipped: 0, failed: 0 });
    expect(rowState.get('r1')?.status).toBe('transcribed');
  });
});

describe('claimRecording', () => {
  it('claims a pending row via compare-and-swap', async () => {
    const rowState = new Map<string, RowState>([['r1', { status: 'pending', processing_at: null }]]);
    const { client } = fakeSupabase({ rowState });

    const claimed = await claimRecording(client, { id: 'r1', status: 'pending' }, new Date('2026-07-14T12:00:00.000Z'));

    expect(claimed).toBe(true);
    expect(rowState.get('r1')).toEqual({ status: 'processing', processing_at: '2026-07-14T12:00:00.000Z' });
  });

  it('fails to claim a row a concurrent invocation already claimed', async () => {
    // This caller's `row` snapshot says 'pending' (read before the race),
    // but the shared table already moved to 'processing' by the time this
    // claim's compare-and-swap runs -- the same shape as a real DB race.
    const rowState = new Map<string, RowState>([['r1', { status: 'processing', processing_at: '2026-07-14T11:59:00.000Z' }]]);
    const { client } = fakeSupabase({ rowState });

    const claimed = await claimRecording(client, { id: 'r1', status: 'pending' }, new Date('2026-07-14T12:00:00.000Z'));

    expect(claimed).toBe(false);
  });

  it('reclaims a processing row abandoned more than 15 minutes ago', async () => {
    const rowState = new Map<string, RowState>([['r1', { status: 'processing', processing_at: '2026-07-14T11:40:00.000Z' }]]); // 20 min old
    const { client } = fakeSupabase({ rowState });

    const claimed = await claimRecording(client, { id: 'r1', status: 'processing' }, new Date('2026-07-14T12:00:00.000Z'));

    expect(claimed).toBe(true);
    expect(rowState.get('r1')).toEqual({ status: 'processing', processing_at: '2026-07-14T12:00:00.000Z' });
  });

  it('does not reclaim a processing row still inside the 15-minute staleness window', async () => {
    const rowState = new Map<string, RowState>([['r1', { status: 'processing', processing_at: '2026-07-14T11:50:00.000Z' }]]); // 10 min old
    const { client } = fakeSupabase({ rowState });

    const claimed = await claimRecording(client, { id: 'r1', status: 'processing' }, new Date('2026-07-14T12:00:00.000Z'));

    expect(claimed).toBe(false);
  });
});
