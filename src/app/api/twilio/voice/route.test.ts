import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  buildVoiceTwiml: vi.fn(() => '<Response><Dial>server-number</Dial></Response>'),
  getContact: vi.fn(),
  getOpportunitiesForContact: vi.fn(),
  getStageNameMap: vi.fn(),
}));

const client = {
  rpc: mocks.rpc,
  from: vi.fn((table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => table === 'live_sessions'
          ? { data: { dial_actor_auth_user_id: 'auth-user-1', lead_id: 'lead-1' }, error: null }
          : { data: { ghl_contact_id: 'ghl-1' }, error: null },
      }),
    }),
  })),
};

vi.mock('@/lib/supabase', () => ({ getSupabaseServerClient: () => client, isSupabaseConfigured: () => true }));
vi.mock('@/lib/live/twilioVoice', () => ({
  verifyTwilioSignature: () => true,
  isTwilioConfigured: () => true,
  hashDialGrant: () => 'dial-hash',
  normalizeTwilioClientIdentity: () => 'client-identity',
  twilioIdentityForAuthUserId: () => 'client-identity',
  buildLiveBridgeStreamUrl: () => 'wss://bridge.example.com/streams/session/grant',
  buildVoiceTwiml: mocks.buildVoiceTwiml,
}));
vi.mock('@/lib/ghl/client', () => ({
  isHighLevelConfigured: () => true,
  getContact: mocks.getContact,
  getOpportunitiesForContact: mocks.getOpportunitiesForContact,
  getStageNameMap: mocks.getStageNameMap,
}));

import { POST } from './route';

function request(signal?: AbortSignal) {
  const form = new FormData();
  form.set('dialGrant', 'opaque-grant');
  form.set('From', 'client:client-identity');
  form.set('To', '+19999999999');
  return new Request('https://ops.example.com/api/twilio/voice', {
    method: 'POST',
    headers: { 'x-twilio-signature': 'signed' },
    body: form,
    signal,
  });
}

describe('POST /api/twilio/voice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LIVE_BRIDGE_URL = 'wss://bridge.example.com';
    mocks.getContact.mockResolvedValue({
      id: 'ghl-1',
      phone: '+1 (555) 123-4567',
      timezone: 'America/New_York',
      dnd: false,
      tags: [],
    });
    mocks.getOpportunitiesForContact.mockResolvedValue([]);
    mocks.getStageNameMap.mockResolvedValue(new Map());
  });
  afterEach(() => delete process.env.LIVE_BRIDGE_URL);

  it('derives the destination from the locked grant and ignores forged client fields', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        result_code: 'authorized',
        session_id: 'session-1',
        call_id: 'call-1',
        lead_id: 'lead-1',
        to_number: '+15551234567',
        contact_timezone: 'America/New_York',
      }],
      error: null,
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.buildVoiceTwiml).toHaveBeenCalledWith(expect.objectContaining({
      toNumber: '+15551234567',
      sessionId: 'session-1',
    }));
    expect(mocks.buildVoiceTwiml).not.toHaveBeenCalledWith(expect.objectContaining({ toNumber: '+19999999999' }));
    expect(mocks.rpc).toHaveBeenCalledWith('consume_authorized_live_dial', expect.objectContaining({
      p_verified_contact_id: 'ghl-1',
      p_verified_to_number: '+15551234567',
      p_verified_timezone: 'America/New_York',
    }));
  });

  it('rechecks current CRM do-not-call state before consuming the grant', async () => {
    mocks.getContact.mockResolvedValue({
      id: 'ghl-1',
      phone: '+15551234567',
      dnd: false,
      dndSettings: { Call: { status: 'active' } },
      tags: [],
    });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects a consumed, expired, or reassigned grant', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ result_code: 'invalid_or_expired' }], error: null });
    const response = await POST(request());
    expect(response.status).toBe(403);
  });

  it('rejects the customer-local quiet-hours boundary without dialing', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ result_code: 'outside_calling_hours' }], error: null });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(mocks.buildVoiceTwiml).not.toHaveBeenCalled();
  });

  it('rejects a verified-contact binding mismatch without dialing', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ result_code: 'contact_binding_mismatch' }], error: null });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.buildVoiceTwiml).not.toHaveBeenCalled();
  });

  it('does not consume the grant after the webhook request is cancelled', async () => {
    const controller = new AbortController();
    mocks.getContact.mockImplementation(async () => {
      controller.abort();
      return { id: 'ghl-1', phone: '+15551234567', dnd: false, tags: [] };
    });

    const response = await POST(request(controller.signal));

    expect(response.status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
