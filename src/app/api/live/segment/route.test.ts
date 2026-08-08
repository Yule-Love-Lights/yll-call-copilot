import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isSupabaseConfigured: vi.fn(),
  getSupabaseAuthServerClient: vi.fn(),
  getSupabaseServerClient: vi.fn(),
  resolveHubActor: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: mocks.isSupabaseConfigured,
  getSupabaseAuthServerClient: mocks.getSupabaseAuthServerClient,
  getSupabaseServerClient: mocks.getSupabaseServerClient,
  isMissingTableError: vi.fn(() => false),
}));

vi.mock('@/lib/auth/actor', () => ({
  resolveHubActor: mocks.resolveHubActor,
}));

vi.mock('@/lib/live/card', () => ({
  generateCoachCard: vi.fn(),
}));

import { POST } from './route';

function request(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request('https://ops.example.com/api/live/segment', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function employeeActor(
  capabilities: string[] = ['office.calls.work'],
  overrides: Record<string, unknown> = {},
) {
  return {
    status: 'resolved',
    actor: {
      principalType: 'employee',
      authUserId: 'auth-1',
      employeeId: 'employee-1',
      email: 'rep@example.com',
      active: true,
      role: 'office',
      memberships: ['office'],
      membershipVersion: null,
      activeDepartmentContext: null,
      capabilities,
      source: 'legacy_app_users',
      ...overrides,
    },
  };
}

describe('POST /api/live/segment authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isSupabaseConfigured.mockReturnValue(true);
    mocks.getSupabaseAuthServerClient.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: 'auth-1', email: 'rep@example.com' } },
          error: null,
        })),
      },
    });
    mocks.resolveHubActor.mockResolvedValue(employeeActor());
  });

  afterEach(() => vi.unstubAllEnvs());

  it('returns 503 before authentication when Supabase is unavailable', async () => {
    mocks.isSupabaseConfigured.mockReturnValue(false);
    const response = await POST(request({}));
    expect(response.status).toBe(503);
    expect(mocks.resolveHubActor).not.toHaveBeenCalled();
  });

  it('requires a configured, exact bridge secret when the bridge header is present', async () => {
    const missing = await POST(
      request({}, { 'x-live-bridge-secret': 'bridge-secret-at-least-16' }),
    );
    expect(missing.status).toBe(503);

    vi.stubEnv('LIVE_BRIDGE_SECRET', 'bridge-secret-at-least-16');
    const denied = await POST(request({}, { 'x-live-bridge-secret': 'incorrect-secret-value' }));
    expect(denied.status).toBe(401);

    const authorized = await POST(
      request({}, { 'x-live-bridge-secret': 'bridge-secret-at-least-16' }),
    );
    expect(authorized.status).toBe(400);
    expect(mocks.getSupabaseAuthServerClient).not.toHaveBeenCalled();
  });

  it('requires the bridge stream grant to have been durably consumed for this Twilio session', async () => {
    vi.stubEnv('LIVE_BRIDGE_SECRET', 'bridge-secret-at-least-16');
    const from = vi.fn(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: 'session-1',
              call_id: 'call-1',
              mode: 'twilio',
              status: 'active',
              transcript_running: '',
              media_stream_started_at: null,
              started_at: '2026-08-07T12:00:00.000Z',
              ended_at: null,
            },
            error: null,
          }),
        }),
      }),
    }));
    mocks.getSupabaseServerClient.mockReturnValue({ from });

    const response = await POST(request(
      { sessionId: 'session-1', speaker: 'rep', text: 'hello' },
      { 'x-live-bridge-secret': 'bridge-secret-at-least-16' },
    ));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'Stream authorization required.' });
  });

  it('denies a browser actor without office.calls.work', async () => {
    mocks.resolveHubActor.mockResolvedValue(employeeActor(['internal_public.read']));
    const response = await POST(request({}));
    expect(response.status).toBe(401);
    expect(mocks.getSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('checks a browser actor against the call that owns the live session', async () => {
    const from = vi.fn((table: string) => {
      if (table === 'live_sessions') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'session-1',
                  call_id: 'call-1',
                  mode: 'simulator',
                  status: 'active',
                  transcript_running: '',
                  started_at: '2026-08-07T12:00:00.000Z',
                  ended_at: null,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'calls') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { rep_email: 'other@example.com' },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });
    mocks.getSupabaseServerClient.mockReturnValue({ from });

    const response = await POST(
      request({ sessionId: 'session-1', speaker: 'rep', text: 'hello' }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'Access denied.' });
  });

  it('allows an approved Owner/Admin team action only after a durable audit', async () => {
    mocks.resolveHubActor.mockResolvedValue(employeeActor(
      ['office.calls.work', 'operations.admin'],
      {
        email: 'admin@example.com',
        role: 'owner_admin',
        memberships: ['office', 'advertising', 'installer', 'management'],
      },
    ));
    const auditInsert = vi.fn(async () => ({ error: null }));
    const from = vi.fn((table: string) => {
      if (table === 'live_sessions') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'session-1', call_id: 'call-1', mode: 'simulator',
                  status: 'ended', transcript_running: '',
                  started_at: '2026-08-07T12:00:00.000Z', ended_at: null,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'calls') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { rep_email: 'rep@example.com' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'events_log') return { insert: auditInsert };
      throw new Error(`unexpected table ${table}`);
    });
    mocks.getSupabaseServerClient.mockReturnValue({ from });

    const response = await POST(
      request({ sessionId: 'session-1', speaker: 'rep', text: 'hello' }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ended: true });
    expect(auditInsert).toHaveBeenCalledOnce();
  });
});
