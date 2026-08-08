import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseServerClient: vi.fn(),
  resolveCurrentHubActor: vi.fn(),
  decideOwnedResourceAccess: vi.fn(),
  auditTeamResourceAccess: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({
  getSupabaseServerClient: mocks.getSupabaseServerClient,
  isSupabaseConfigured: vi.fn(() => true),
  isMissingTableError: vi.fn(() => false),
}));
vi.mock('@/lib/auth/resource', () => ({
  resolveCurrentHubActor: mocks.resolveCurrentHubActor,
  decideOwnedResourceAccess: mocks.decideOwnedResourceAccess,
  auditTeamResourceAccess: mocks.auditTeamResourceAccess,
}));
vi.mock('@/lib/claude', () => ({ isClaudeConfigured: vi.fn(() => false) }));
vi.mock('@/lib/leads/followups', () => ({ generateFollowups: vi.fn() }));
vi.mock('@/lib/transcripts/process', () => ({ processTranscriptBatch: vi.fn() }));

import { POST } from './route';

const CALL_ID = '11111111-1111-1111-1111-111111111111';
const actor = {
  email: 'admin@example.com', authUserId: 'auth-admin', employeeId: 'employee-admin',
  capabilities: ['operations.admin'],
};

function request() {
  return new Request('https://ops.example.com/api/calls', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      leadId: 'lead-1', callId: CALL_ID, outcome: 'no_answer', notes: 'updated',
    }),
  });
}

function database() {
  const callUpdate = vi.fn(() => ({
    eq: () => ({ eq: async () => ({ error: null }) }),
  }));
  const leadUpdate = vi.fn(() => ({ eq: async () => ({ error: null }) }));
  const from = vi.fn((table: string) => {
    if (table === 'leads') {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: {
            id: 'lead-1', ghl_contact_id: 'ghl-1', full_name: 'Person', phone: '+15551234567',
            email: null, address: null, vertical_slug: null, reason: 'test', opener_hint: null,
            score: 1, source: 'test', status: 'claimed', claimed_by: null,
            timezone: 'America/New_York', queued_at: '2026-08-07T00:00:00Z', done_at: null,
          },
          error: null,
        }) }) }),
        update: leadUpdate,
      };
    }
    if (table === 'calls') {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: { id: CALL_ID, lead_id: 'lead-1', rep_email: 'rep@example.com' }, error: null,
        }) }) }),
        update: callUpdate,
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
  return { client: { from }, callUpdate, leadUpdate };
}

describe('POST /api/calls resource authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCurrentHubActor.mockResolvedValue({ status: 'resolved', actor });
    mocks.auditTeamResourceAccess.mockResolvedValue(true);
  });

  it('does not update another employee call without an explicit override', async () => {
    mocks.decideOwnedResourceAccess.mockReturnValue('denied');
    const db = database();
    mocks.getSupabaseServerClient.mockReturnValue(db.client);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(db.callUpdate).not.toHaveBeenCalled();
    expect(db.leadUpdate).not.toHaveBeenCalled();
  });

  it('audits an admin correction and preserves the original call attribution', async () => {
    mocks.decideOwnedResourceAccess.mockReturnValue('team');
    const db = database();
    mocks.getSupabaseServerClient.mockReturnValue(db.client);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.auditTeamResourceAccess).toHaveBeenCalledOnce();
    expect(db.callUpdate).toHaveBeenCalledWith({
      outcome: 'no_answer', notes: 'updated', ended_at: expect.any(String),
    });
  });
});
