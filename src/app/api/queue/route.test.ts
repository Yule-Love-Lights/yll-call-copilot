import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseServerClient: vi.fn(),
  resolveCurrentHubActor: vi.fn(),
  isWithinCallingHours: vi.fn(() => true),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseServerClient: mocks.getSupabaseServerClient,
  isSupabaseConfigured: vi.fn(() => true),
  isMissingTableError: vi.fn(() => false),
}));
vi.mock('@/lib/auth/resource', () => ({
  resolveCurrentHubActor: mocks.resolveCurrentHubActor,
}));
vi.mock('@/lib/leads/callingHours', () => ({
  isWithinCallingHours: mocks.isWithinCallingHours,
}));

import { GET } from './route';

const rep = {
  email: 'rep@example.com',
  employeeId: 'employee-rep',
  capabilities: ['office.calls.work'],
};
const admin = {
  email: 'admin@example.com',
  employeeId: 'employee-admin',
  capabilities: ['office.calls.work', 'office.pipeline.run', 'operations.admin'],
};

const rows = [
  {
    id: 'queued-1', ghl_contact_id: 'ghl-queued', full_name: 'Queued Person', phone: '+15550000001',
    email: 'queued@example.com', address: '1 Private Rd', vertical_slug: 'holiday', reason: 'Call soon',
    opener_hint: 'Warm', score: 100, source: 'inbound_speed', status: 'queued', claimed_by: null, claimed_employee_id: null,
    timezone: 'America/New_York', queued_at: '2026-08-11T12:00:00.000Z',
  },
  {
    id: 'mine-1', ghl_contact_id: 'ghl-mine', full_name: 'My Person', phone: '+15550000002',
    email: 'mine@example.com', address: '2 Private Rd', vertical_slug: 'holiday', reason: 'Mine',
    opener_hint: 'Warm', score: 90, source: 'season_play', status: 'claimed', claimed_by: 'rep@example.com', claimed_employee_id: 'employee-rep',
    timezone: 'America/New_York', queued_at: '2026-08-11T12:01:00.000Z',
  },
  {
    id: 'foreign-1', ghl_contact_id: 'ghl-foreign', full_name: 'Foreign Person', phone: '+15550000003',
    email: 'foreign@example.com', address: '3 Private Rd', vertical_slug: 'holiday', reason: 'Foreign',
    opener_hint: 'Warm', score: 80, source: 'season_play', status: 'claimed', claimed_by: 'other@example.com', claimed_employee_id: 'employee-other',
    timezone: 'America/New_York', queued_at: '2026-08-11T12:02:00.000Z',
  },
];

function database() {
  const queueQuery: Record<string, unknown> = {};
  queueQuery.in = vi.fn(() => queueQuery);
  queueQuery.order = vi.fn(() => queueQuery);
  queueQuery.eq = vi.fn(() => queueQuery);
  queueQuery.gte = vi.fn(() => queueQuery);
  Object.assign(queueQuery, { then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null }) });

  const from = vi.fn((table: string) => {
    if (table === 'leads') return { select: vi.fn(() => queueQuery) };
    if (table === 'events_log') {
      return {
        select: () => ({
          eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
  return { from };
}

describe('GET /api/queue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('redacts queued previews and removes another rep claimed row', async () => {
    mocks.resolveCurrentHubActor.mockResolvedValue({ status: 'resolved', actor: rep });
    mocks.getSupabaseServerClient.mockReturnValue(database());

    const response = await GET(new Request('https://ops.example.com/api/queue'));
    const json = await response.json();

    expect(json.leads).toHaveLength(2);
    expect(json.canBuildQueue).toBe(false);
    expect(json.leads[0]).toMatchObject({
      id: 'queued-1', fullName: null, phone: null, email: null, address: null,
      redacted: true, canOpen: false, isMine: false,
    });
    expect(json.leads[1]).toMatchObject({
      id: 'mine-1', fullName: 'My Person', phone: null, email: null,
      redacted: false, canOpen: true, isMine: true,
    });
    expect(json.leads.some((lead: { id: string }) => lead.id === 'foreign-1')).toBe(false);
  });

  it('lets Owner/Admin review the team queue without granting work ownership', async () => {
    mocks.resolveCurrentHubActor.mockResolvedValue({ status: 'resolved', actor: admin });
    mocks.getSupabaseServerClient.mockReturnValue(database());

    const response = await GET(new Request('https://ops.example.com/api/queue'));
    const json = await response.json();
    expect(json.canBuildQueue).toBe(true);
    expect(json.leads).toHaveLength(3);
    expect(json.leads[0]).toMatchObject({ fullName: 'Queued Person', redacted: false, canOpen: true, isMine: false });
    expect(json.leads[2]).toMatchObject({ claimedBy: 'other@example.com', canOpen: true, isMine: false });
  });

  it('resolves the actor before querying lead data', async () => {
    const db = database();
    mocks.getSupabaseServerClient.mockReturnValue(db);
    mocks.resolveCurrentHubActor.mockResolvedValue({ status: 'denied' });

    const response = await GET(new Request('https://ops.example.com/api/queue'));
    expect(response.status).toBe(403);
    expect(db.from).not.toHaveBeenCalled();
  });
});
