import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), verifyHeaderSecret: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  getSupabaseServerClient: () => ({ rpc: mocks.rpc }),
  isSupabaseConfigured: () => true,
}));
vi.mock('@/lib/auth/machine', () => ({ verifyHeaderSecret: mocks.verifyHeaderSecret }));

import { POST } from './route';

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const STREAM_GRANT = 'a'.repeat(43);

function request() {
  return new Request('https://ops.example.com/api/live/stream/authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-live-bridge-secret': 'bridge-secret' },
    body: JSON.stringify({ sessionId: SESSION_ID, streamGrant: STREAM_GRANT }),
  });
}

describe('POST /api/live/stream/authorize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyHeaderSecret.mockReturnValue('authorized');
  });

  it('atomically authorizes one current claimed stream', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ result_code: 'authorized', session_id: SESSION_ID }], error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('consume_authorized_live_stream', {
      p_session_id: SESSION_ID,
      p_media_stream_grant_hash: expect.any(String),
    });
  });

  it('recovers the same stream after an authorization response is lost', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ result_code: 'already_authorized', session_id: SESSION_ID }], error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ authorized: true, alreadyAuthorized: true });
  });

  it('rejects replay, expiry, claim loss, and grant mismatch', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ result_code: 'invalid_or_expired' }], error: null });
    const response = await POST(request());
    expect(response.status).toBe(403);
  });

  it('fails closed when the durable transition is unavailable', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    const response = await POST(request());
    expect(response.status).toBe(503);
  });
});
