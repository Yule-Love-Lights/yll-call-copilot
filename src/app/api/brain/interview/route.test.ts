// Coverage for POST /api/brain/interview: request-body validation, the
// Claude-unavailable degrade (raw answers saved as manual-style rows, one
// per answered question), the happy path (distilled insights PLUS the raw-
// transcript backstop row both get inserted), the distill-throws fallback
// (only the backstop row lands, nothing the operator typed is lost), and
// the missing-table degrade. distillInterview itself is mocked -- its own
// behavior (validateInsights) is covered by distillInterview.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const getSessionEmailMock = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  getSessionEmail: (...args: unknown[]) => getSessionEmailMock(...args),
}));

const isClaudeConfiguredMock = vi.fn();
vi.mock('@/lib/claude', () => ({
  isClaudeConfigured: (...args: unknown[]) => isClaudeConfiguredMock(...args),
}));

const distillInterviewMock = vi.fn();
vi.mock('@/lib/brain/distillInterview', () => ({
  distillInterview: (...args: unknown[]) => distillInterviewMock(...args),
}));

let fakeClient: SupabaseClient;
let fromMock: ReturnType<typeof vi.fn>;
let insertMock: ReturnType<typeof vi.fn>;
vi.mock('@/lib/supabase', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supabase')>('@/lib/supabase');
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    getSupabaseServerClient: () => fakeClient,
  };
});

import { POST } from './route';

type QueryResult = { data: unknown; error: unknown };

function fakeSupabase(result: QueryResult) {
  insertMock = vi.fn((rows: unknown) => ({
    select: () => ({
      then: (onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(onFulfilled, onRejected),
    }),
    // Expose what was passed to insert() for assertions.
    __rows: rows,
  }));
  fromMock = vi.fn((table: string) => {
    if (table !== 'brain_insights') throw new Error(`Unexpected table in test: ${table}`);
    return { insert: insertMock };
  });
  return { from: fromMock } as unknown as SupabaseClient;
}

function postRequest(body: unknown) {
  return new Request('http://localhost/api/brain/interview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const QA = [
  { question: 'What is happening in your market right now?', lens: 'market', answer: 'Storms are up this year.' },
  { question: 'Describe your best-fit customer.', lens: 'leads', answer: 'Homeowners who already own, not renters.' },
  { question: 'A blank one.', lens: 'general', answer: '' },
];

const INSERTED_ROWS = [
  { id: 'r1', vertical_id: null, source: 'interview', lens: 'market', title: 'Storms drive urgency', content: 'x', created_by: null, created_at: '2026-07-18T00:00:00Z' },
];

describe('POST /api/brain/interview', () => {
  beforeEach(() => {
    getSessionEmailMock.mockReset();
    isClaudeConfiguredMock.mockReset();
    distillInterviewMock.mockReset();
  });

  it('rejects a non-array body', async () => {
    fakeClient = fakeSupabase({ data: null, error: null });

    const res = await POST(postRequest({ not: 'an array' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.saved).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('rejects an item with an invalid lens', async () => {
    fakeClient = fakeSupabase({ data: null, error: null });

    const res = await POST(postRequest([{ question: 'q', lens: 'pricing', answer: 'a' }]));

    expect(res.status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('rejects when every answer is blank', async () => {
    fakeClient = fakeSupabase({ data: null, error: null });

    const res = await POST(postRequest([{ question: 'q', lens: 'general', answer: '   ' }]));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.reason).toBe('Answer at least one question first.');
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('degrades to raw manual-style rows, one per answered question, when Claude is not configured', async () => {
    isClaudeConfiguredMock.mockReturnValue(false);
    getSessionEmailMock.mockResolvedValue('naldo@yulelovelights.com');
    fakeClient = fakeSupabase({ data: INSERTED_ROWS, error: null });

    const res = await POST(postRequest(QA));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.saved).toBe(true);
    expect(distillInterviewMock).not.toHaveBeenCalled();

    const insertedRows = insertMock.mock.calls[0][0] as { source: string; lens: string }[];
    // Only the 2 answered questions become rows -- the blank one is dropped.
    expect(insertedRows).toHaveLength(2);
    expect(insertedRows.every(r => r.source === 'manual')).toBe(true);
    expect(insertedRows.map(r => r.lens).sort()).toEqual(['leads', 'market']);
  });

  it('inserts the distilled insights plus a raw-transcript backstop row on the happy path', async () => {
    isClaudeConfiguredMock.mockReturnValue(true);
    getSessionEmailMock.mockResolvedValue('naldo@yulelovelights.com');
    distillInterviewMock.mockResolvedValue([
      { lens: 'market', title: 'Storms drive urgency', content: 'Tightened.' },
      { lens: 'leads', title: 'Owner-occupant signal', content: 'Tightened.' },
    ]);
    fakeClient = fakeSupabase({ data: INSERTED_ROWS, error: null });

    const res = await POST(postRequest(QA));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.saved).toBe(true);
    expect(distillInterviewMock).toHaveBeenCalledTimes(1);

    const insertedRows = insertMock.mock.calls[0][0] as { source: string; lens: string; title: string }[];
    // 2 distilled + 1 raw-transcript backstop.
    expect(insertedRows).toHaveLength(3);
    expect(insertedRows.filter(r => r.source === 'interview')).toHaveLength(3);
    const backstop = insertedRows.find(r => r.title.startsWith('Interview notes'));
    expect(backstop).toBeDefined();
    expect(backstop?.lens).toBe('general');
  });

  it('still saves the raw-transcript backstop row when distillation throws (nothing typed is lost)', async () => {
    isClaudeConfiguredMock.mockReturnValue(true);
    getSessionEmailMock.mockResolvedValue('naldo@yulelovelights.com');
    distillInterviewMock.mockRejectedValue(new Error('Claude returned invalid insights'));
    fakeClient = fakeSupabase({ data: INSERTED_ROWS, error: null });

    const res = await POST(postRequest(QA));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.saved).toBe(true);

    const insertedRows = insertMock.mock.calls[0][0] as { source: string; title: string; content: string }[];
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].title).toMatch(/^Interview notes/);
    // The raw content still carries both real answers verbatim.
    expect(insertedRows[0].content).toContain('Storms are up this year.');
    expect(insertedRows[0].content).toContain('Homeowners who already own, not renters.');
  });

  it('degrades on a missing table', async () => {
    isClaudeConfiguredMock.mockReturnValue(false);
    getSessionEmailMock.mockResolvedValue(null);
    fakeClient = fakeSupabase({ data: null, error: { code: 'PGRST205' } });

    const res = await POST(postRequest(QA));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.saved).toBe(false);
    expect(json.reason).toBe('Run migration 0015 first.');
  });
});
