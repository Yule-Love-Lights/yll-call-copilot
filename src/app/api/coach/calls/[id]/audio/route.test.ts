// Coverage for GET /api/coach/calls/[id]/audio: a rep gets a 403 before
// any call_scores/call_recordings query runs (recordings are customer PII
// same as the transcript they come from), a call with no usable GHL
// recording 404s with a small JSON body instead of a broken <audio> tag,
// a found recording streams the mp3 bytes with the right headers, and a
// GHL download failure degrades to a 502 JSON rather than crashing. Mock
// style matches the sibling route tests in this directory.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const getSessionEmailMock = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  getSessionEmail: (...args: unknown[]) => getSessionEmailMock(...args),
}));

const downloadRecordingAudioMock = vi.fn();
vi.mock('@/lib/ghl/recordings', () => ({
  downloadRecordingAudio: (...args: unknown[]) => downloadRecordingAudioMock(...args),
}));

let fakeClient: SupabaseClient;
let fromMock: ReturnType<typeof vi.fn>;
vi.mock('@/lib/supabase', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supabase')>('@/lib/supabase');
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    getSupabaseServerClient: () => fakeClient,
  };
});

import { GET } from './route';

function fakeSupabase(
  role: string | null,
  scoreRow: Record<string, unknown> | null,
  recordingRow: Record<string, unknown> | null = null,
) {
  fromMock = vi.fn((table: string) => {
    if (table === 'ops_employees') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: role ? { role, active: true } : null, error: null }) }) }) };
    }
    if (table === 'call_scores') {
      const builder = { eq: () => builder, maybeSingle: async () => ({ data: scoreRow, error: null }) };
      return { select: () => builder };
    }
    if (table === 'call_recordings') {
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: recordingRow, error: null }) }) }) }) };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });
  return { from: fromMock } as unknown as SupabaseClient;
}

function fakeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/coach/calls/[id]/audio', () => {
  beforeEach(() => {
    getSessionEmailMock.mockReset();
    downloadRecordingAudioMock.mockReset();
  });

  it('403s a rep and never queries call_scores or call_recordings', async () => {
    getSessionEmailMock.mockResolvedValue('rep@yulelovelights.com');
    fakeClient = fakeSupabase('office', null);

    const res = await GET(new Request('http://localhost/api/coach/calls/c1/audio'), fakeParams('c1'));

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("Call review is for the coach's one-on-one prep, not a rep-facing page.");
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith('ops_employees');
    expect(downloadRecordingAudioMock).not.toHaveBeenCalled();
  });

  it('404s an unknown call id without ever querying call_recordings', async () => {
    getSessionEmailMock.mockResolvedValue('naldo@yulelovelights.com');
    fakeClient = fakeSupabase('owner', null);

    const res = await GET(new Request('http://localhost/api/coach/calls/missing/audio'), fakeParams('missing'));

    expect(res.status).toBe(404);
    expect(fromMock).not.toHaveBeenCalledWith('call_recordings');
    expect(downloadRecordingAudioMock).not.toHaveBeenCalled();
  });

  it('404s with a small JSON body when the call has no GHL recording (historical RingCentral transcript)', async () => {
    getSessionEmailMock.mockResolvedValue('naldo@yulelovelights.com');
    fakeClient = fakeSupabase('owner', { id: 'c1', transcript_id: 't1' }, null);

    const res = await GET(new Request('http://localhost/api/coach/calls/c1/audio'), fakeParams('c1'));

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('No recording available for this call.');
    expect(downloadRecordingAudioMock).not.toHaveBeenCalled();
  });

  it('streams the mp3 bytes with the right headers when a transcribed recording exists', async () => {
    getSessionEmailMock.mockResolvedValue('naldo@yulelovelights.com');
    fakeClient = fakeSupabase('owner', { id: 'c1', transcript_id: 't1' }, { ghl_message_id: 'msg-1' });
    const fakeBytes = Buffer.from('fake-mp3-bytes');
    downloadRecordingAudioMock.mockResolvedValue(fakeBytes);

    const res = await GET(new Request('http://localhost/api/coach/calls/c1/audio'), fakeParams('c1'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(res.headers.get('Content-Length')).toBe(String(fakeBytes.length));
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
    expect(downloadRecordingAudioMock).toHaveBeenCalledWith('msg-1');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.toString()).toBe('fake-mp3-bytes');
  });

  it('degrades a GHL download failure to a 502 JSON instead of crashing', async () => {
    getSessionEmailMock.mockResolvedValue('naldo@yulelovelights.com');
    fakeClient = fakeSupabase('owner', { id: 'c1', transcript_id: 't1' }, { ghl_message_id: 'msg-1' });
    downloadRecordingAudioMock.mockRejectedValue(new Error('GHL 500'));

    const res = await GET(new Request('http://localhost/api/coach/calls/c1/audio'), fakeParams('c1'));

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(typeof json.error).toBe('string');
  });
});
