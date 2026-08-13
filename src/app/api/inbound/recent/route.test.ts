import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseServerClient: vi.fn(),
  resolveCurrentHubActor: vi.fn(),
  authorizeLeadDetailRead: vi.fn(),
  callFilters: [] as [string, unknown][],
  isWithinCallingHours: vi.fn(),
  getContact: vi.fn(),
  getOpportunitiesForContact: vi.fn(),
  getStageNameMap: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseServerClient: mocks.getSupabaseServerClient,
  isSupabaseConfigured: vi.fn(() => true),
  isMissingTableError: vi.fn(() => false),
}));
vi.mock('@/lib/auth/resource', () => ({
  resolveCurrentHubActor: mocks.resolveCurrentHubActor,
}));
vi.mock('@/lib/auth/leadWork', () => ({
  authorizeLeadDetailRead: mocks.authorizeLeadDetailRead,
}));
vi.mock('@/lib/ghl/client', () => ({
  getContact: mocks.getContact,
  getOpportunitiesForContact: mocks.getOpportunitiesForContact,
  getStageNameMap: mocks.getStageNameMap,
  isHighLevelConfigured: vi.fn(() => true),
}));
vi.mock('@/lib/leads/callingHours', () => ({
  isWithinCallingHours: mocks.isWithinCallingHours,
}));

import { GET } from './route';

const rep = { email: 'rep@example.com', employeeId: 'employee-rep', capabilities: ['office.calls.work'] };
const admin = { email: 'admin@example.com', employeeId: 'employee-admin', capabilities: ['office.calls.work', 'operations.admin'] };

function database(leads: Record<string, Record<string, unknown>>) {
  const events = Object.keys(leads).map((contactId, index) => ({
    id: index + 1,
    detail: { contactId, name: `Private ${index + 1}`, phone: `+1555000000${index + 1}` },
    created_at: '2026-08-11T12:00:00.000Z',
  }));
  const from = vi.fn((table: string) => {
    if (table === 'events_log') {
      const chain: Record<string, unknown> = {};
      chain.eq = vi.fn(() => chain);
      chain.gte = vi.fn(() => chain);
      chain.order = vi.fn(async () => ({ data: events, error: null }));
      return { select: vi.fn(() => chain) };
    }
    if (table === 'leads') {
      return {
        select: () => ({
          eq: (_field: string, value: string) => ({
            maybeSingle: async () => ({ data: leads[value] ?? null, error: null }),
          }),
        }),
      };
    }
    if (table === 'calls') {
      const chain: Record<string, unknown> = {};
      chain.eq = vi.fn((field: string, value: unknown) => {
        mocks.callFilters.push([field, value]);
        return chain;
      });
      Object.assign(chain, {
        then: (resolve: (value: unknown) => unknown) => resolve({ count: 0, error: null }),
      });
      return {
        select: () => chain,
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
  return { from };
}

describe('GET /api/inbound/recent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callFilters.length = 0;
    mocks.isWithinCallingHours.mockReturnValue(true);
    mocks.getContact.mockResolvedValue({
      id: 'ghl-contact', dnd: false, dndSettings: { Call: { status: 'inactive' } }, tags: [], timezone: 'America/New_York',
    });
    mocks.getOpportunitiesForContact.mockResolvedValue([]);
    mocks.getStageNameMap.mockResolvedValue(new Map());
  });

  it('resolves the actor before reading inbound customer events', async () => {
    const db = database({});
    mocks.getSupabaseServerClient.mockReturnValue(db);
    mocks.resolveCurrentHubActor.mockResolvedValue({ status: 'denied' });
    const response = await GET();
    expect(response.status).toBe(403);
    expect(db.from).not.toHaveBeenCalled();
  });

  it('redacts an unclaimed inbound preview and omits a foreign claimed lead', async () => {
    const db = database({
      queued: { id: 'lead-queued', reason: 'Inbound call just now', status: 'queued', claimed_by: null, claimed_employee_id: null },
      foreign: { id: 'lead-foreign', reason: 'Claimed', status: 'claimed', claimed_by: 'other@example.com', claimed_employee_id: 'employee-other' },
    });
    mocks.getSupabaseServerClient.mockReturnValue(db);
    mocks.resolveCurrentHubActor.mockResolvedValue({ status: 'resolved', actor: rep });
    mocks.authorizeLeadDetailRead.mockResolvedValue({ status: 'denied' });

    const response = await GET();
    const json = await response.json();
    expect(json.events).toHaveLength(1);
    expect(json.events[0]).toMatchObject({
      leadId: 'lead-queued', name: null, phone: null, redacted: true,
      canClaim: true, canOpen: false,
    });
    expect(mocks.callFilters).toContainEqual(['metric_scope', 'performance']);
  });

  it('returns audited Owner/Admin team records as reviewable but not implicitly claimed', async () => {
    const db = database({
      queued: { id: 'lead-queued', reason: 'Inbound call just now', status: 'queued', claimed_by: null, claimed_employee_id: null },
    });
    mocks.getSupabaseServerClient.mockReturnValue(db);
    mocks.resolveCurrentHubActor.mockResolvedValue({ status: 'resolved', actor: admin });
    mocks.authorizeLeadDetailRead.mockResolvedValue({
      status: 'authorized', access: 'team', canWork: false, canManageFollowups: false,
    });

    const response = await GET();
    const json = await response.json();
    expect(json.events[0]).toMatchObject({
      name: 'Private 1', phone: null, redacted: false,
      canClaim: true, canOpen: true,
    });
    expect(mocks.authorizeLeadDetailRead).toHaveBeenCalledOnce();
  });

  it('does not permit a claim or open outside the contact calling hours', async () => {
    const db = database({
      queued: { id: 'lead-queued', reason: 'Inbound call just now', status: 'queued', claimed_by: null, claimed_employee_id: null },
    });
    mocks.getSupabaseServerClient.mockReturnValue(db);
    mocks.resolveCurrentHubActor.mockResolvedValue({ status: 'resolved', actor: admin });
    mocks.authorizeLeadDetailRead.mockResolvedValue({
      status: 'authorized', access: 'team', canWork: false, canManageFollowups: false,
    });
    mocks.isWithinCallingHours.mockReturnValue(false);

    const response = await GET();
    const json = await response.json();

    expect(json.events[0]).toMatchObject({ phone: null, canClaim: false, canOpen: false });
  });

  it('does not permit a claim when a current pipeline stage blocks calls', async () => {
    const db = database({
      queued: { id: 'lead-queued', reason: 'Inbound call just now', status: 'queued', claimed_by: null, claimed_employee_id: null },
    });
    mocks.getSupabaseServerClient.mockReturnValue(db);
    mocks.resolveCurrentHubActor.mockResolvedValue({ status: 'resolved', actor: rep });
    mocks.getOpportunitiesForContact.mockResolvedValue([{ pipelineStageId: 'stage-dnc' }]);
    mocks.getStageNameMap.mockResolvedValue(new Map([['stage-dnc', 'DO NOT CALL']]));

    const response = await GET();
    const json = await response.json();

    expect(json.events[0]).toMatchObject({ phone: null, canClaim: false, canOpen: false });
  });
});
