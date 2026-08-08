import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashMediaStreamGrant } from '@/lib/live/twilioVoice';

const mocks = vi.hoisted(() => ({
  getSupabaseServerClient: vi.fn(),
  isSupabaseConfigured: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseServerClient: mocks.getSupabaseServerClient,
  isSupabaseConfigured: mocks.isSupabaseConfigured,
}));

import { POST } from './route';

const SECRET = 'bridge-secret-at-least-16';
const SESSION_ID = '123e4567-e89b-12d3-a456-426614174000';
const STREAM_GRANT = 'a'.repeat(43);

function request(
  body: unknown,
  secret: string | undefined = SECRET,
): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== undefined) headers['x-live-bridge-secret'] = secret;
  return new Request('https://ops.example.com/api/live/stream/authorize', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function database(result: { data: Array<{ id: string }> | null; error: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.gt = vi.fn(() => chain);
  chain.select = vi.fn(async () => result);
  const update = vi.fn(() => chain);
  const from = vi.fn(() => ({ update }));
  return { client: { from }, from, update, chain };
}

describe('POST /api/live/stream/authorize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('LIVE_BRIDGE_SECRET', SECRET);
    mocks.isSupabaseConfigured.mockReturnValue(true);
  });

  afterEach(() => vi.unstubAllEnvs());

  it('fails closed when configuration or the exact bridge secret is missing', async () => {
    mocks.isSupabaseConfigured.mockReturnValue(false);
    expect((await POST(request({}))).status).toBe(503);

    mocks.isSupabaseConfigured.mockReturnValue(true);
    vi.stubEnv('LIVE_BRIDGE_SECRET', '');
    expect((await POST(request({}))).status).toBe(503);

    vi.stubEnv('LIVE_BRIDGE_SECRET', SECRET);
    expect((await POST(request({}, 'incorrect-secret-value'))).status).toBe(401);
  });

  it('atomically consumes the matching unexpired grant and retains its digest', async () => {
    const db = database({ data: [{ id: SESSION_ID }], error: null });
    mocks.getSupabaseServerClient.mockReturnValue(db.client);

    const response = await POST(request({ sessionId: SESSION_ID, streamGrant: STREAM_GRANT }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authorized: true, sessionId: SESSION_ID });
    expect(db.update).toHaveBeenCalledWith({ media_stream_started_at: expect.any(String) });
    expect(db.chain.eq).toHaveBeenCalledWith('id', SESSION_ID);
    expect(db.chain.eq).toHaveBeenCalledWith('mode', 'twilio');
    expect(db.chain.eq).toHaveBeenCalledWith('status', 'active');
    expect(db.chain.eq).toHaveBeenCalledWith(
      'media_stream_grant_hash',
      hashMediaStreamGrant(STREAM_GRANT),
    );
    expect(db.chain.is).toHaveBeenCalledWith('media_stream_started_at', null);
    expect(db.chain.gt).toHaveBeenCalledWith(
      'media_stream_grant_expires_at',
      expect.any(String),
    );
  });

  it('rejects replay, expiry, wrong session, and wrong grant when the atomic update matches no row', async () => {
    const db = database({ data: [], error: null });
    mocks.getSupabaseServerClient.mockReturnValue(db.client);

    const response = await POST(request({ sessionId: SESSION_ID, streamGrant: STREAM_GRANT }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('already used') });
  });

  it('rejects malformed grants before touching the database', async () => {
    const response = await POST(request({ sessionId: SESSION_ID, streamGrant: 'short' }));
    expect(response.status).toBe(400);
    expect(mocks.getSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('fails closed when durable consumption is unavailable', async () => {
    const db = database({ data: null, error: { message: 'database unavailable' } });
    mocks.getSupabaseServerClient.mockReturnValue(db.client);
    const response = await POST(request({ sessionId: SESSION_ID, streamGrant: STREAM_GRANT }));
    expect(response.status).toBe(503);
  });
});
