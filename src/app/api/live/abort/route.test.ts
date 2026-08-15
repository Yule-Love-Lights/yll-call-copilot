import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), resolveCurrentHubActor: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  getSupabaseServerClient: () => ({ rpc: mocks.rpc }),
  isSupabaseConfigured: () => true,
  isMissingTableError: () => false,
}));
vi.mock('@/lib/auth/resource', () => ({ resolveCurrentHubActor: mocks.resolveCurrentHubActor }));

import { POST } from './route';

const SESSION_ID = '11111111-2222-4333-8444-555555555555';

function request() {
  return new Request('https://ops.example.com/api/live/abort', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: SESSION_ID }),
  });
}

describe('POST /api/live/abort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCurrentHubActor.mockResolvedValue({
      status: 'resolved',
      actor: { employeeId: 'employee-1', email: 'rep@example.com' },
    });
  });

  it('abandons only an undialed setup attempt', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ result_code: 'abandoned', session_id: SESSION_ID, already_abandoned: false }],
      error: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ configured: true, abandoned: true, alreadyAbandoned: false });
  });

  it.each(['active_attempt', 'pending_outcome'])('refuses to abandon a %s call', async resultCode => {
    mocks.rpc.mockResolvedValue({ data: [{ result_code: resultCode }], error: null });

    const response = await POST(request());

    expect(response.status).toBe(409);
  });

  it.each(['not_owned', 'claim_lost'])('does not let an administrator or former claimant cancel another employee attempt', async resultCode => {
    mocks.resolveCurrentHubActor.mockResolvedValue({
      status: 'resolved',
      actor: { employeeId: 'admin-1', email: 'admin@example.com' },
    });
    mocks.rpc.mockResolvedValue({ data: [{ result_code: resultCode }], error: null });

    const response = await POST(request());

    expect(response.status).toBe(403);
  });
});
