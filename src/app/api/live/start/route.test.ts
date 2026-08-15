import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  resolveCurrentHubActor: vi.fn(),
  createIdempotentDialGrant: vi.fn(),
  isTwilioConfigured: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseServerClient: () => ({ rpc: mocks.rpc }),
  isSupabaseConfigured: () => true,
  isMissingTableError: () => false,
}));
vi.mock('@/lib/auth/resource', () => ({ resolveCurrentHubActor: mocks.resolveCurrentHubActor }));
vi.mock('@/lib/live/twilioVoice', () => ({
  createIdempotentDialGrant: mocks.createIdempotentDialGrant,
  isTwilioConfigured: mocks.isTwilioConfigured,
}));

import { POST } from './route';

const LEAD_ID = '11111111-2222-4333-8444-555555555555';
const CALL_ID = '21111111-2222-4333-8444-555555555555';
const SESSION_ID = '31111111-2222-4333-8444-555555555555';
const START_REQUEST_ID = '41111111-2222-4333-8444-555555555555';

function request(body: Record<string, unknown> = { leadId: LEAD_ID, startRequestId: START_REQUEST_ID }) {
  return new Request('https://ops.example.com/api/live/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/live/start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCurrentHubActor.mockResolvedValue({
      status: 'resolved',
      actor: {
        employeeId: 'employee-1',
        authUserId: 'auth-1',
        email: 'rep@example.com',
      },
    });
    mocks.createIdempotentDialGrant.mockReturnValue({ grant: 'dial-grant', hash: 'dial-hash' });
    mocks.isTwilioConfigured.mockReturnValue(true);
  });

  it('returns the dial grant for a newly created starting attempt', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ result_code: 'starting', call_id: CALL_ID, session_id: SESSION_ID }],
      error: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      saved: true,
      status: 'starting',
      callId: CALL_ID,
      sessionId: SESSION_ID,
      dialGrant: 'dial-grant',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('start_claimed_live_attempt', expect.objectContaining({
      p_actor_employee_id: 'employee-1',
      p_actor_auth_user_id: 'auth-1',
      p_actor_email: 'rep@example.com',
      p_lead_id: LEAD_ID,
      p_start_request_id: START_REQUEST_ID,
      p_dial_grant_hash: 'dial-hash',
    }));
    expect(mocks.createIdempotentDialGrant).toHaveBeenCalledWith('auth-1', START_REQUEST_ID);
  });

  it('cannot create a live attempt while customer calling is release-blocked', async () => {
    mocks.isTwilioConfigured.mockReturnValue(false);

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(mocks.resolveCurrentHubActor).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(['active', 'pending_outcome'] as const)('recovers an existing %s attempt without a new dial grant', async status => {
    mocks.rpc.mockResolvedValue({
      data: [{ result_code: status, call_id: CALL_ID, session_id: SESSION_ID }],
      error: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ saved: true, status, dialGrant: null });
  });

  it('does not give an administrator a work override for another employee claim', async () => {
    mocks.resolveCurrentHubActor.mockResolvedValue({
      status: 'resolved',
      actor: { employeeId: 'admin-1', authUserId: 'admin-auth', email: 'admin@example.com' },
    });
    mocks.rpc.mockResolvedValue({
      data: [{ result_code: 'not_claimed_by_actor', call_id: null, session_id: null }],
      error: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ saved: false });
  });

  it('rejects simulator inputs instead of forwarding a mode to the database', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ result_code: 'starting', call_id: CALL_ID, session_id: SESSION_ID }],
      error: null,
    });

    const response = await POST(request({ leadId: LEAD_ID, startRequestId: START_REQUEST_ID, mode: 'simulator' }));

    expect(response.status).toBe(200);
    expect(mocks.rpc.mock.calls[0]?.[1]).not.toHaveProperty('p_mode');
  });

  it('rejects a missing logical start request id before creating a grant', async () => {
    const response = await POST(request({ leadId: LEAD_ID }));

    expect(response.status).toBe(400);
    expect(mocks.createIdempotentDialGrant).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('maps a different logical start while setup is open to a conflict', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ result_code: 'start_conflict', call_id: CALL_ID, session_id: SESSION_ID }],
      error: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ saved: false });
  });
});
