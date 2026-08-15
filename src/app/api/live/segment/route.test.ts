import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), verifyHeaderSecret: vi.fn() }));
const client = {
  rpc: mocks.rpc,
  from: vi.fn(() => ({
    select: () => ({ eq: async () => ({ data: [], error: null }) }),
  })),
};
vi.mock('@/lib/supabase', () => ({
  getSupabaseServerClient: () => client,
  isSupabaseConfigured: () => true,
  isMissingTableError: () => false,
}));
vi.mock('@/lib/auth/machine', () => ({ verifyHeaderSecret: mocks.verifyHeaderSecret }));
vi.mock('@/lib/live/card', () => ({ generateCoachCard: vi.fn() }));

import { POST } from './route';

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const SEGMENT_ID = '21111111-2222-4333-8444-555555555555';

function request(body: Record<string, unknown> = {}, bridge = true) {
  return new Request('https://ops.example.com/api/live/segment', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bridge ? { 'x-live-bridge-secret': 'bridge-secret' } : {}),
    },
    body: JSON.stringify({
      sessionId: SESSION_ID,
      sourceSegmentId: SEGMENT_ID,
      speaker: 'rep',
      text: 'Hello there',
      atMs: 1000,
      ...body,
    }),
  });
}

describe('POST /api/live/segment bridge boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyHeaderSecret.mockReturnValue('authorized');
  });

  it('rejects browser transcript fabrication', async () => {
    mocks.verifyHeaderSecret.mockReturnValue('denied');
    const response = await POST(request({}, false));
    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('requires a stable source segment id for retry deduplication', async () => {
    const response = await POST(request({ sourceSegmentId: undefined }));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(['not_authorized', 'actor_inactive'])('fails instead of silently dropping a segment when the RPC returns %s', async resultCode => {
    mocks.rpc.mockResolvedValue({ data: [{ result_code: resultCode }], error: null });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ saved: false });
  });

  it('returns an idempotent duplicate without generating another card', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        result_code: 'already_saved',
        segment_id: SEGMENT_ID,
        call_id: '31111111-2222-4333-8444-555555555555',
        ordinal: 1,
        at_ms: 1000,
        transcript_running: 'rep: Hello there',
        inserted: false,
      }],
      error: null,
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ saved: true, duplicate: true, card: null });
    expect(client.from).not.toHaveBeenCalled();
  });
});
