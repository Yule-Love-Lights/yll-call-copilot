import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseServerClient: vi.fn(),
  resolveCurrentHubActor: vi.fn(),
  getContact: vi.fn(),
  getOpportunitiesForContact: vi.fn(),
  getStageNameMap: vi.fn(),
  isWithinCallingHours: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseServerClient: mocks.getSupabaseServerClient,
  isSupabaseConfigured: vi.fn(() => true),
}));
vi.mock('@/lib/auth/resource', () => ({
  resolveCurrentHubActor: mocks.resolveCurrentHubActor,
}));
vi.mock('@/lib/ghl/client', () => ({
  isHighLevelConfigured: () => true,
  getContact: mocks.getContact,
  getOpportunitiesForContact: mocks.getOpportunitiesForContact,
  getStageNameMap: mocks.getStageNameMap,
}));
vi.mock('@/lib/leads/callingHours', () => ({
  isWithinCallingHours: mocks.isWithinCallingHours,
}));

import { POST } from './route';

const actor = {
  employeeId: '11111111-1111-4111-8111-111111111111',
  authUserId: '22222222-2222-4222-8222-222222222222',
  email: 'rep@example.com',
};

function request(action: string) {
  return new Request('https://ops.example.com/api/leads/33333333-3333-4333-8333-333333333333/decide', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
}

describe('POST /api/leads/[id]/decide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCurrentHubActor.mockResolvedValue({ status: 'resolved', actor });
    mocks.getContact.mockResolvedValue({
      id: 'ghl-1', dnd: false, dndSettings: { Call: { status: 'inactive' } }, tags: [], timezone: 'America/New_York',
    });
    mocks.getOpportunitiesForContact.mockResolvedValue([]);
    mocks.getStageNameMap.mockResolvedValue(new Map());
    mocks.isWithinCallingHours.mockReturnValue(true);
  });

  it('binds a claim to the resolved actor through the transactional routine', async () => {
    const rpc = vi.fn(async () => ({ data: [{ result_code: 'claimed' }], error: null }));
    const maybeSingle = vi.fn(async () => ({ data: { ghl_contact_id: 'ghl-1' }, error: null }));
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    mocks.getSupabaseServerClient.mockReturnValue({ rpc, from: () => ({ select }) });

    const response = await POST(request('claim'), {
      params: Promise.resolve({ id: '33333333-3333-4333-8333-333333333333' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ decided: true, status: 'claimed' });
    expect(rpc).toHaveBeenCalledWith('decide_queued_lead', {
      p_actor_employee_id: actor.employeeId,
      p_actor_auth_user_id: actor.authUserId,
      p_actor_email: actor.email,
      p_lead_id: '33333333-3333-4333-8333-333333333333',
      p_action: 'claim',
      p_verified_contact_id: 'ghl-1',
      p_call_permission_verified: true,
      p_verified_timezone: 'America/New_York',
    });
  });

  it('does not touch lead data when actor resolution fails', async () => {
    const rpc = vi.fn();
    mocks.getSupabaseServerClient.mockReturnValue({ rpc });
    mocks.resolveCurrentHubActor.mockResolvedValue({ status: 'denied' });

    const response = await POST(request('dismiss'), {
      params: Promise.resolve({ id: '33333333-3333-4333-8333-333333333333' }),
    });

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns a conflict when another decision won the row lock', async () => {
    const maybeSingle = vi.fn(async () => ({ data: { ghl_contact_id: 'ghl-1' }, error: null }));
    mocks.getSupabaseServerClient.mockReturnValue({
      rpc: vi.fn(async () => ({ data: [{ result_code: 'not_queued' }], error: null })),
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    });

    const response = await POST(request('claim'), {
      params: Promise.resolve({ id: '33333333-3333-4333-8333-333333333333' }),
    });
    expect(response.status).toBe(409);
  });

  it('fails closed before claiming when the current contact blocks calls', async () => {
    const rpc = vi.fn();
    const maybeSingle = vi.fn(async () => ({ data: { ghl_contact_id: 'ghl-1' }, error: null }));
    mocks.getSupabaseServerClient.mockReturnValue({
      rpc,
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    });
    mocks.getContact.mockResolvedValue({
      id: 'ghl-1',
      dnd: false,
      dndSettings: { Call: { status: 'active' } },
      tags: [],
    });

    const response = await POST(request('claim'), {
      params: Promise.resolve({ id: '33333333-3333-4333-8333-333333333333' }),
    });

    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('fails closed before claiming outside the contact\'s current calling hours', async () => {
    const rpc = vi.fn();
    const maybeSingle = vi.fn(async () => ({ data: { ghl_contact_id: 'ghl-1' }, error: null }));
    mocks.getSupabaseServerClient.mockReturnValue({
      rpc,
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    });
    mocks.isWithinCallingHours.mockReturnValue(false);

    const response = await POST(request('claim'), {
      params: Promise.resolve({ id: '33333333-3333-4333-8333-333333333333' }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ decided: false, reason: expect.stringContaining('outside calling hours') });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a malformed lead id before resolving or calling the database', async () => {
    const rpc = vi.fn();
    mocks.getSupabaseServerClient.mockReturnValue({ rpc });
    const response = await POST(request('claim'), {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });
    expect(response.status).toBe(400);
    expect(mocks.resolveCurrentHubActor).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
