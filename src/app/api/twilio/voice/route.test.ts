import twilio from 'twilio';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseServerClient: vi.fn(),
  isSupabaseConfigured: vi.fn(),
  isWithinCallingHours: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseServerClient: mocks.getSupabaseServerClient,
  isSupabaseConfigured: mocks.isSupabaseConfigured,
}));

vi.mock('@/lib/leads/callingHours', () => ({
  isWithinCallingHours: mocks.isWithinCallingHours,
}));

import { POST } from './route';
import { hashMediaStreamGrant, twilioIdentityForAuthUserId } from '@/lib/live/twilioVoice';

const URL = 'https://ops.example.com/api/twilio/voice';
const AUTH_TOKEN = 'twilio-auth-token';
const CLIENT_IDENTITY = twilioIdentityForAuthUserId('auth-user-1');

function signedRequest(params: Record<string, string>): Request {
  const signature = twilio.getExpectedTwilioSignature(AUTH_TOKEN, URL, params);
  return new Request(URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signature,
    },
    body: new URLSearchParams(params),
  });
}

function fakeSupabase(options: {
  identity?: string;
  consumed?: boolean;
} = {}) {
  const session = {
    id: 'real-session',
    call_id: 'call-1',
    mode: 'twilio',
    status: 'active',
    transcript_running: '',
    dial_grant_hash: 'hash',
    dial_actor_auth_user_id: options.identity ?? 'auth-user-1',
    dial_grant_expires_at: '2099-01-01T00:00:00.000Z',
    dial_started_at: null,
    started_at: '2026-08-07T12:00:00.000Z',
    ended_at: null,
  };
  const update = vi.fn((payload: Record<string, unknown>) => {
    void payload;
    const chain: Record<string, unknown> = {};
    chain.eq = vi.fn(() => chain);
    chain.is = vi.fn(() => chain);
    chain.gt = vi.fn(() => chain);
    chain.select = vi.fn(async () => ({
      data: options.consumed === false ? [] : [{ id: session.id }],
      error: null,
    }));
    return chain;
  });
  const from = vi.fn((table: string) => {
    if (table === 'live_sessions') {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: session, error: null }) }),
        }),
        update,
      };
    }
    if (table === 'calls') {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { id: 'call-1', lead_id: 'lead-1' }, error: null }) }),
        }),
      };
    }
    if (table === 'leads') {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { phone: '+15551234567', timezone: 'America/New_York' }, error: null }) }),
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
  return { client: { from }, from, update };
}

describe('POST /api/twilio/voice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TWILIO_AUTH_TOKEN', AUTH_TOKEN);
    vi.stubEnv('TWILIO_CALLER_ID', '+15550000000');
    vi.stubEnv('LIVE_BRIDGE_URL', 'wss://bridge.example.com');
    mocks.isSupabaseConfigured.mockReturnValue(true);
    mocks.isWithinCallingHours.mockReturnValue(true);
  });

  afterEach(() => vi.unstubAllEnvs());

  it('derives the destination and session from a one-time grant, ignoring forged client fields', async () => {
    const database = fakeSupabase();
    mocks.getSupabaseServerClient.mockReturnValue(database.client);

    const response = await POST(signedRequest({
      dialGrant: 'opaque-grant',
      From: `client:${CLIENT_IDENTITY}`,
      To: '+19999999999',
      sessionId: 'forged-session',
    }));
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(xml).toContain('+15551234567');
    expect(xml).toContain('value="real-session"');
    const streamUrlMatch = xml.match(
      /url="wss:\/\/bridge\.example\.com\/streams\/real-session\/([A-Za-z0-9_-]{43})"/,
    );
    expect(streamUrlMatch).not.toBeNull();
    expect(xml).not.toContain('+19999999999');
    expect(xml).not.toContain('forged-session');
    expect(database.update).toHaveBeenCalledWith(expect.objectContaining({
      dial_started_at: expect.any(String),
      media_stream_grant_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      media_stream_grant_expires_at: expect.any(String),
      media_stream_started_at: null,
    }));
    const updatePayload = database.update.mock.calls[0][0] as {
      media_stream_grant_hash: string;
    };
    expect(hashMediaStreamGrant(streamUrlMatch![1])).toBe(
      updatePayload.media_stream_grant_hash,
    );
  });

  it('rejects a grant used by a different Twilio client identity', async () => {
    const database = fakeSupabase();
    mocks.getSupabaseServerClient.mockReturnValue(database.client);

    const response = await POST(signedRequest({
      dialGrant: 'opaque-grant',
      From: `client:${twilioIdentityForAuthUserId('another-auth-user')}`,
    }));

    expect(response.status).toBe(403);
    expect(database.update).not.toHaveBeenCalled();
  });

  it('rejects an atomically consumed/replayed grant', async () => {
    const database = fakeSupabase({ consumed: false });
    mocks.getSupabaseServerClient.mockReturnValue(database.client);

    const response = await POST(signedRequest({
      dialGrant: 'opaque-grant',
      From: `client:${CLIENT_IDENTITY}`,
    }));

    expect(response.status).toBe(409);
    expect(await response.text()).toContain('already used');
  });

  it('rechecks customer-local calling hours before consuming the grant', async () => {
    mocks.isWithinCallingHours.mockReturnValue(false);
    const database = fakeSupabase();
    mocks.getSupabaseServerClient.mockReturnValue(database.client);

    const response = await POST(signedRequest({
      dialGrant: 'opaque-grant',
      From: `client:${CLIENT_IDENTITY}`,
    }));

    expect(response.status).toBe(409);
    expect(database.update).not.toHaveBeenCalled();
  });

  it('fails closed without consuming the grant when the public bridge URL is insecure', async () => {
    vi.stubEnv('LIVE_BRIDGE_URL', 'ws://bridge.example.com');
    const database = fakeSupabase();
    mocks.getSupabaseServerClient.mockReturnValue(database.client);

    const response = await POST(signedRequest({
      dialGrant: 'opaque-grant',
      From: `client:${CLIENT_IDENTITY}`,
    }));

    expect(response.status).toBe(503);
    expect(database.update).not.toHaveBeenCalled();
  });
});
