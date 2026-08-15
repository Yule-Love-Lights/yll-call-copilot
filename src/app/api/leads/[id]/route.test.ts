import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseServerClient: vi.fn(),
  resolveCurrentHubActor: vi.fn(),
  authorizeLeadDetailRead: vi.fn(),
  callScopeFilters: [] as [string, unknown[]][],
  getContact: vi.fn(),
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
  getContactPageUrl: vi.fn(() => 'https://ghl.example/contact'),
  getOpportunitiesForContact: vi.fn(async () => []),
  getStageNameMap: vi.fn(async () => new Map()),
  isHighLevelConfigured: vi.fn(() => false),
}));
vi.mock('@/lib/transcripts/insights', () => ({
  computeInsights: vi.fn(async () => ({ ok: false })),
}));
vi.mock('@/lib/live/twilioVoice', () => ({ isTwilioConfigured: vi.fn(() => false) }));

import { GET } from './route';

const actor = { email: 'rep@example.com' };
const lead = {
  id: 'lead-1', ghl_contact_id: 'ghl-1', full_name: 'Customer', phone: '+15551234567',
  email: 'customer@example.com', address: '1 Private Rd', vertical_slug: null, reason: 'Call',
  opener_hint: null, score: 10, source: 'season_play', status: 'claimed', claimed_by: 'rep@example.com',
  timezone: 'America/New_York', queued_at: '2026-08-11T12:00:00.000Z', done_at: null,
};

function single(value: unknown) {
  return { eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: value, error: null })) })) };
}

function database(options: {
  call?: Record<string, unknown> | null;
  session?: Record<string, unknown> | null;
  followups?: Record<string, unknown>[];
} = {}) {
  const call = options.call === undefined
    ? {
        id: 'call-1', outcome: null, notes: null, rep_email: 'rep@example.com',
        started_at: '2026-08-11T12:05:00.000Z', ended_at: null,
      }
    : options.call;
  const session = options.session === undefined
    ? {
        id: 'session-1', call_id: 'call-1', status: 'active',
        started_at: '2026-08-11T12:05:00.000Z',
      }
    : options.session;
  const from = vi.fn((table: string) => {
    if (table === 'leads') return { select: () => single(lead) };
    if (table === 'calls') {
      const chain: Record<string, unknown> = {};
      chain.eq = vi.fn(() => chain);
      chain.in = vi.fn((field: string, values: unknown[]) => {
        mocks.callScopeFilters.push([field, values]);
        return chain;
      });
      chain.order = vi.fn(() => chain);
      chain.limit = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(async () => ({ data: call, error: null }));
      return { select: vi.fn(() => chain) };
    }
    if (table === 'followups') {
      return {
        select: () => ({ eq: () => ({ order: async () => ({ data: options.followups ?? [], error: null }) }) }),
      };
    }
    if (table === 'live_sessions') {
      const chain: Record<string, unknown> = {};
      chain.eq = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(async () => ({ data: session, error: null }));
      return { select: vi.fn(() => chain) };
    }
    throw new Error(`unexpected table ${table}`);
  });
  return { from };
}

describe('GET /api/leads/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callScopeFilters.length = 0;
    mocks.resolveCurrentHubActor.mockResolvedValue({ status: 'resolved', actor });
    mocks.authorizeLeadDetailRead.mockResolvedValue({
      status: 'authorized', access: 'self', canWork: true, canManageFollowups: true,
    });
    mocks.getContact.mockRejectedValue(new Error('GHL unavailable'));
  });

  it('resolves the actor before loading customer data', async () => {
    const db = database();
    mocks.getSupabaseServerClient.mockReturnValue(db);
    mocks.resolveCurrentHubActor.mockResolvedValue({ status: 'denied' });

    const response = await GET(new Request('https://ops.example.com/api/leads/lead-1'), {
      params: Promise.resolve({ id: 'lead-1' }),
    });
    expect(response.status).toBe(403);
    expect(db.from).not.toHaveBeenCalled();
  });

  it('returns 404 before GHL, calls, or followups for a foreign ordinary read', async () => {
    const db = database();
    mocks.getSupabaseServerClient.mockReturnValue(db);
    mocks.authorizeLeadDetailRead.mockResolvedValue({ status: 'denied' });

    const response = await GET(new Request('https://ops.example.com/api/leads/lead-1'), {
      params: Promise.resolve({ id: 'lead-1' }),
    });
    expect(response.status).toBe(404);
    expect(db.from).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledWith('leads');
  });

  it('returns work flags and a live attempt for self recovery', async () => {
    const db = database();
    mocks.getSupabaseServerClient.mockReturnValue(db);

    const response = await GET(new Request('https://ops.example.com/api/leads/lead-1'), {
      params: Promise.resolve({ id: 'lead-1' }),
    });
    const json = await response.json();
    expect(json).toMatchObject({
      canWork: true,
      canManageFollowups: true,
      liveCallingEnabled: false,
      callPermissionVerified: false,
      liveAttempt: {
        sessionId: 'session-1', callId: 'call-1', status: 'active',
        startedAt: '2026-08-11T12:05:00.000Z',
      },
    });
    expect(mocks.callScopeFilters).toContainEqual(['metric_scope', ['pending', 'performance']]);
  });

  it('keeps an Owner/Admin foreign inspection read-only', async () => {
    const db = database({ call: null, session: null });
    mocks.getSupabaseServerClient.mockReturnValue(db);
    mocks.authorizeLeadDetailRead.mockResolvedValue({
      status: 'authorized', access: 'team', canWork: false, canManageFollowups: false,
    });

    const response = await GET(new Request('https://ops.example.com/api/leads/lead-1'), {
      params: Promise.resolve({ id: 'lead-1' }),
    });
    const json = await response.json();
    expect(json).toMatchObject({ canWork: false, canManageFollowups: false });
    expect(json.lead.phone).toBeNull();
  });

  it('does not expose a saved SMS recipient when current call permission is unavailable', async () => {
    const db = database({
      followups: [{
        id: 'followup-1', call_id: 'call-1', kind: 'sms', to_address: '+15551234567',
        subject: null, body: 'Following up', status: 'draft', created_at: '2026-08-11T12:06:00.000Z', sent_at: null,
      }],
    });
    mocks.getSupabaseServerClient.mockReturnValue(db);

    const response = await GET(new Request('https://ops.example.com/api/leads/lead-1'), {
      params: Promise.resolve({ id: 'lead-1' }),
    });
    const json = await response.json();

    expect(json.callPermissionVerified).toBe(false);
    expect(json.lead.phone).toBeNull();
    expect(json.followups[0].toAddress).toBe('');
  });

  it('redacts an email and saved email recipient when the current channel is opted out', async () => {
    mocks.getContact.mockResolvedValue({
      id: 'ghl-1', email: 'customer@example.com', dnd: false,
      dndSettings: { Call: { status: 'inactive' }, Email: { status: 'active' } },
      tags: [], timezone: 'America/New_York',
    });
    const db = database({
      followups: [{
        id: 'followup-email', call_id: 'call-1', kind: 'email', to_address: 'customer@example.com',
        subject: 'Hello', body: 'Following up', status: 'draft', created_at: '2026-08-11T12:06:00.000Z', sent_at: null,
      }],
    });
    mocks.getSupabaseServerClient.mockReturnValue(db);

    const response = await GET(new Request('https://ops.example.com/api/leads/lead-1'), {
      params: Promise.resolve({ id: 'lead-1' }),
    });
    const json = await response.json();

    expect(json.callPermissionVerified).toBe(true);
    expect(json.lead.email).toBeNull();
    expect(json.contact.email).toBeUndefined();
    expect(json.followups[0].toAddress).toBe('');
  });
});
