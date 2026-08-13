import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: { rpc: vi.fn(), from: vi.fn() },
  resolveCurrentHubActor: vi.fn(),
  getContact: vi.fn(),
  getOpportunitiesForContact: vi.fn(),
  getStageNameMap: vi.fn(),
  isClaudeConfigured: vi.fn(),
  generateFollowups: vi.fn(),
  processTranscriptBatch: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseServerClient: () => mocks.client,
  isSupabaseConfigured: () => true,
  isMissingTableError: () => false,
}));
vi.mock('@/lib/auth/resource', () => ({ resolveCurrentHubActor: mocks.resolveCurrentHubActor }));
vi.mock('@/lib/claude', () => ({ isClaudeConfigured: mocks.isClaudeConfigured }));
vi.mock('@/lib/leads/followups', () => ({ generateFollowups: mocks.generateFollowups }));
vi.mock('@/lib/transcripts/process', () => ({ processTranscriptBatch: mocks.processTranscriptBatch }));
vi.mock('@/lib/ghl/client', () => ({
  isHighLevelConfigured: () => true,
  getContact: mocks.getContact,
  getOpportunitiesForContact: mocks.getOpportunitiesForContact,
  getStageNameMap: mocks.getStageNameMap,
}));

import { POST } from './route';

const LEAD_ID = '11111111-2222-4333-8444-555555555555';
const REQUEST_ID = '21111111-2222-4333-8444-555555555555';

function request(overrides: Record<string, unknown> = {}) {
  return new Request('https://ops.example.com/api/calls', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      leadId: LEAD_ID,
      outcome: 'no_answer',
      notes: '',
      completionRequestId: REQUEST_ID,
      ...overrides,
    }),
  });
}

describe('POST /api/calls transactional authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCurrentHubActor.mockResolvedValue({
      status: 'resolved',
      actor: { employeeId: 'employee-1', authUserId: 'auth-1', email: 'rep@example.com' },
    });
    mocks.getContact.mockResolvedValue({
      id: 'ghl-1', dnd: false, dndSettings: { Call: { status: 'inactive' } }, tags: [],
    });
    mocks.getOpportunitiesForContact.mockResolvedValue([]);
    mocks.getStageNameMap.mockResolvedValue(new Map());
    mocks.isClaudeConfigured.mockReturnValue(false);
    const maybeSingle = vi.fn(async () => ({ data: { ghl_contact_id: 'ghl-1' }, error: null }));
    mocks.client.from.mockImplementation((table: string) => {
      if (table === 'leads') return { select: () => ({ eq: () => ({ maybeSingle }) }) };
      throw new Error(`unexpected table ${table}`);
    });
  });

  it('rejects completion after the employee loses the lead claim', async () => {
    mocks.client.rpc.mockResolvedValue({ data: [{ result_code: 'not_claimed_by_actor' }], error: null });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(mocks.client.rpc).toHaveBeenCalledWith('complete_owned_lead_call', expect.objectContaining({
      p_actor_employee_id: 'employee-1',
      p_lead_id: LEAD_ID,
      p_completion_request_id: REQUEST_ID,
      p_verified_contact_id: null,
      p_call_permission_verified: false,
    }));
    expect(mocks.client.from).not.toHaveBeenCalled();
  });

  it('does not give an admin a foreign-work override', async () => {
    mocks.resolveCurrentHubActor.mockResolvedValue({
      status: 'resolved',
      actor: { employeeId: 'admin-1', authUserId: 'auth-admin', email: 'admin@example.com' },
    });
    mocks.client.rpc.mockResolvedValue({ data: [{ result_code: 'not_claimed_by_actor' }], error: null });
    const response = await POST(request());
    expect(response.status).toBe(403);
  });

  it('fails a conflicting idempotency-key reuse without reading customer data', async () => {
    mocks.client.rpc.mockResolvedValue({ data: [{ result_code: 'request_conflict' }], error: null });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(mocks.client.from).not.toHaveBeenCalled();
    expect(mocks.getContact).not.toHaveBeenCalled();
  });

  it('fails closed before completion when current Call permission is disabled', async () => {
    mocks.getContact.mockResolvedValue({
      id: 'ghl-1', dnd: false, dndSettings: { Call: { status: 'active' } }, tags: [],
    });
    mocks.client.rpc.mockResolvedValue({ data: [{ result_code: 'call_not_authorized' }], error: null });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(mocks.client.rpc).toHaveBeenCalledTimes(1);
  });

  it('verifies current Call permission only for a fresh completion, then completes on the second transaction', async () => {
    mocks.client.rpc
      .mockResolvedValueOnce({ data: [{ result_code: 'call_not_authorized' }], error: null })
      .mockResolvedValueOnce({
        data: [{ result_code: 'completed', call_id: 'call-1', session_id: null, transcript_id: null, status: 'completed' }],
        error: null,
      });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ saved: true, alreadyCompleted: false, callId: 'call-1' });
    expect(mocks.client.rpc).toHaveBeenNthCalledWith(2, 'complete_owned_lead_call', expect.objectContaining({
      p_verified_contact_id: 'ghl-1',
      p_call_permission_verified: true,
    }));
  });

  it('re-drives an exact committed retry without requiring HighLevel to be available again', async () => {
    mocks.client.rpc.mockResolvedValue({
      data: [{ result_code: 'already_completed', call_id: 'call-1', session_id: null, transcript_id: null, status: 'completed' }],
      error: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ saved: true, alreadyCompleted: true, callId: 'call-1' });
    expect(mocks.getContact).not.toHaveBeenCalled();
    expect(mocks.client.rpc).toHaveBeenCalledTimes(1);
  });

  it('keeps the stable retry request when follow-up generation fails after the call commits', async () => {
    mocks.isClaudeConfigured.mockReturnValue(true);
    mocks.generateFollowups.mockRejectedValue(new Error('temporary generation failure'));
    const maybeSingle = vi.fn(async () => ({
      data: { ghl_contact_id: 'ghl-1', email: 'customer@example.com', phone: null, vertical_slug: null },
      error: null,
    }));
    mocks.client.from.mockImplementation((table: string) => {
      if (table === 'leads') return { select: () => ({ eq: () => ({ maybeSingle }) }) };
      throw new Error(`unexpected table ${table}`);
    });
    mocks.client.rpc
      .mockResolvedValueOnce({ data: [{ result_code: 'call_not_authorized' }], error: null })
      .mockResolvedValueOnce({
        data: [{ result_code: 'completed', call_id: 'call-1', session_id: null, transcript_id: null, status: 'completed' }],
        error: null,
      });

    const response = await POST(request({ outcome: 'callback' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      saved: true,
      postProcessingComplete: false,
      followups: { generated: false, reason: 'temporary generation failure' },
    });
  });
});
