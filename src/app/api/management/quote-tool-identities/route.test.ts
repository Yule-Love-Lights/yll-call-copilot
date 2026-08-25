import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getSupabaseServerClient: vi.fn(),
  hasCapability: vi.fn(),
  resolveCurrentHubActor: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase', () => ({ getSupabaseServerClient: mocks.getSupabaseServerClient }));
vi.mock('@/lib/auth/capabilities', () => ({ hasCapability: mocks.hasCapability }));
vi.mock('@/lib/auth/resource', () => ({
  resolveCurrentHubActor: mocks.resolveCurrentHubActor,
  actorResolutionStatus: (resolution: { status: string }) =>
    resolution.status === 'unavailable' ? 503 : resolution.status === 'denied' ? 403 : null,
}));

import { POST } from './route';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const EMPLOYEE_ID = '22222222-2222-4222-8222-222222222222';
const QUOTE_USER_ID = '33333333-3333-4333-8333-333333333333';
const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';

function request(body: unknown, key = IDEMPOTENCY_KEY) {
  return new NextRequest('https://ops.example.com/api/management/quote-tool-identities', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-idempotency-key': key,
    },
    body: JSON.stringify(body),
  });
}

function quoteClient(users: Array<{ id: string; email: string; email_confirmed_at: string | null; banned_until: string | null }>) {
  return {
    auth: {
      admin: {
        listUsers: vi.fn(async () => ({ data: { users }, error: null })),
      },
    },
  };
}

function hubClient(input: { employees?: unknown[]; employeeError?: unknown; rpcError?: unknown }) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    limit: vi.fn(async () => ({ data: input.employees ?? [{ id: EMPLOYEE_ID }], error: input.employeeError ?? null })),
  };
  return {
    from: vi.fn(() => query),
    rpc: vi.fn(async () => ({ data: true, error: input.rpcError ?? null })),
  };
}

describe('/api/management/quote-tool-identities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCurrentHubActor.mockResolvedValue({
      status: 'resolved',
      actor: { employeeId: ACTOR_ID },
    });
    mocks.hasCapability.mockReturnValue(true);
    process.env.QUOTE_TOOL_SUPABASE_URL = 'https://quote.example.test';
    process.env.QUOTE_TOOL_SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('denies a caller without operations-admin capability before reading either identity system', async () => {
    mocks.hasCapability.mockReturnValue(false);

    const response = await POST(request({ email: 'jason@example.com', reason: 'existing Office employee' }));

    expect(response.status).toBe(403);
    expect(mocks.getSupabaseServerClient).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('requires a valid idempotency key before looking up a user', async () => {
    const response = await POST(request({ email: 'jason@example.com', reason: 'existing Office employee' }, 'not-a-uuid'));

    expect(response.status).toBe(400);
    expect(mocks.getSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('links exactly one confirmed Quote Tool user to exactly one active Hub employee', async () => {
    const quote = quoteClient([{
      id: QUOTE_USER_ID,
      email: 'Jason@Example.com',
      email_confirmed_at: '2026-08-25T00:00:00Z',
      banned_until: null,
    }]);
    const hub = hubClient({});
    mocks.createClient.mockReturnValue(quote);
    mocks.getSupabaseServerClient.mockReturnValue(hub);

    const response = await POST(request({ email: ' Jason@Example.com ', reason: 'Existing Office employee' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(hub.rpc).toHaveBeenCalledWith('owner_link_quote_tool_employee_identity', {
      p_actor_employee_id: ACTOR_ID,
      p_employee_id: EMPLOYEE_ID,
      p_quote_tool_auth_user_id: QUOTE_USER_ID,
      p_reason: 'Existing Office employee',
      p_idempotency_key: IDEMPOTENCY_KEY,
    });
  });

  it('rejects an ambiguous Quote Tool account without revealing identity details', async () => {
    const quote = quoteClient([
      { id: QUOTE_USER_ID, email: 'jason@example.com', email_confirmed_at: '2026-08-25T00:00:00Z', banned_until: null },
      { id: '55555555-5555-4555-8555-555555555555', email: 'jason@example.com', email_confirmed_at: '2026-08-25T00:00:00Z', banned_until: null },
    ]);
    mocks.createClient.mockReturnValue(quote);
    mocks.getSupabaseServerClient.mockReturnValue(hubClient({}));

    const response = await POST(request({ email: 'jason@example.com', reason: 'Existing Office employee' }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: 'IDENTITY_LINK_UNCONFIRMED' });
  });

  it('accepts an account whose temporary Quote Tool ban has already expired', async () => {
    mocks.createClient.mockReturnValue(quoteClient([{
      id: QUOTE_USER_ID,
      email: 'jason@example.com',
      email_confirmed_at: '2026-08-25T00:00:00Z',
      banned_until: '2020-01-01T00:00:00Z',
    }]));
    const hub = hubClient({});
    mocks.getSupabaseServerClient.mockReturnValue(hub);

    const response = await POST(request({ email: 'jason@example.com', reason: 'Existing Office employee' }));

    expect(response.status).toBe(200);
    expect(hub.rpc).toHaveBeenCalledOnce();
  });

  it('does not link when Hub employee lookup is ambiguous', async () => {
    mocks.createClient.mockReturnValue(quoteClient([{
      id: QUOTE_USER_ID,
      email: 'jason@example.com',
      email_confirmed_at: '2026-08-25T00:00:00Z',
      banned_until: null,
    }]));
    const hub = hubClient({ employees: [{ id: EMPLOYEE_ID }, { id: '66666666-6666-4666-8666-666666666666' }] });
    mocks.getSupabaseServerClient.mockReturnValue(hub);

    const response = await POST(request({ email: 'jason@example.com', reason: 'Existing Office employee' }));

    expect(response.status).toBe(409);
    expect(hub.rpc).not.toHaveBeenCalled();
  });
});
