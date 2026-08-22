import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  resolveHubActor: vi.fn(),
  auditSensitiveRouteAccess: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: mocks.createServerClient,
}));

vi.mock('@/lib/auth/actor', () => ({
  resolveHubActor: mocks.resolveHubActor,
}));

vi.mock('@/lib/auth/resource', () => ({
  auditSensitiveRouteAccess: mocks.auditSensitiveRouteAccess,
}));

import { config, proxy } from './proxy';

function request(path: string, origin = 'https://ops.yulelovelights.com') {
  return new NextRequest(`${origin}${path}`);
}

function unavailableConfiguration() {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
}

function completeConfiguration() {
  vi.stubEnv(
    'NEXT_PUBLIC_SUPABASE_URL',
    process.env.VERCEL_ENV === 'preview'
      ? 'https://ewbtkrytrnerypdkuimd.supabase.co'
      : 'https://mjmociuxxxwxvasnpxav.supabase.co',
  );
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_publishable_1234567890abcdefghij');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
}

function signedIn(email: string | null = 'jason@example.com') {
  mocks.createServerClient.mockReturnValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: {
          user: {
            id: 'auth-user-1',
            ...(email === null ? {} : { email }),
          },
        },
        error: null,
      })),
    },
  });
}

function phoneJwtClaims(overrides: Record<string, unknown> = {}) {
  return {
    aud: 'authenticated',
    is_anonymous: false,
    role: 'authenticated',
    session_id: '11111111-1111-4111-8111-111111111111',
    sub: 'auth-user-1',
    phone: '+16315550123',
    amr: [{ method: 'otp', timestamp: Math.floor(Date.now() / 1000) }],
    ...overrides,
  };
}

function actorWith(capabilities: string[], role = 'office') {
  return {
    status: 'resolved',
    actor: {
      principalType: 'employee',
      authUserId: 'auth-user-1',
      employeeId: 'employee-1',
      email: 'jason@example.com',
      active: true,
      role,
      memberships: role === 'owner_admin'
        ? ['office', 'advertising', 'installer']
        : ['office'],
      membershipVersion: 1,
      activeDepartmentContext: null,
      capabilities,
      source: 'ops_identity',
    },
  };
}

const OFFICE_CAPABILITIES = [
  'office.tools.use',
  'office.scoreboard.self',
  'office.customer.search',
  'office.calls.work',
  'office.coaching.self',
];

describe('root authentication proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('HUB_PHONE_AUTH_STAGING_ENABLED', 'false');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
    vi.stubEnv('VERCEL_ENV', 'production');
    mocks.resolveHubActor.mockResolvedValue(actorWith(OFFICE_CAPABILITIES));
    mocks.auditSensitiveRouteAccess.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a generic 503 for a protected production page with no configuration', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    unavailableConfiguration();

    const response = await proxy(request('/scoreboard'));

    expect(response.status).toBe(503);
    expect(await response.text()).toBe('Authentication is temporarily unavailable.');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.resolveHubActor).not.toHaveBeenCalled();
  });

  it('returns a generic 503 JSON error for a protected API', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    unavailableConfiguration();

    const response = await proxy(request('/api/scoreboard'));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: 'AUTH_SERVICE_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable.',
      },
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('blocks partial configuration before session or actor work begins', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    completeConfiguration();
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');

    const response = await proxy(request('/api/ghl/contacts/search'));

    expect(response.status).toBe(503);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.resolveHubActor).not.toHaveBeenCalled();
  });

  it('keeps only public auth/recovery and health paths reachable without configuration', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    unavailableConfiguration();

    for (const path of ['/login', '/forgot-password', '/reset-password', '/api/health']) {
      const response = await proxy(request(path));
      expect(response.headers.get('x-middleware-next')).toBe('1');
    }

    expect((await proxy(request('/api/health/private'))).status).toBe(503);

    for (const path of ['/api/webhooks/ghl', '/api/twilio/voice', '/api/cron/score-calls']) {
      expect((await proxy(request(path))).status).toBe(503);
    }
  });

  it('lets a configured machine request reach its own route authentication', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    completeConfiguration();

    const response = await proxy(
      new NextRequest('https://ops.yulelovelights.com/api/webhooks/ghl', { method: 'POST' }),
    );

    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it('has no missing-configuration bypass in local development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    unavailableConfiguration();

    expect((await proxy(request('/scoreboard', 'http://localhost:3000'))).status).toBe(503);
  });

  it('preserves the signed-out redirect after valid configuration', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    completeConfiguration();
    mocks.createServerClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
      },
    });

    const response = await proxy(request('/scoreboard'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://ops.yulelovelights.com/login');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('treats Supabase\'s missing-session error as signed out, not an outage', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    completeConfiguration();
    mocks.createServerClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: { name: 'AuthSessionMissingError' },
        })),
      },
    });

    const response = await proxy(request('/api/scoreboard'));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Not signed in' });
  });

  it('clears terminal session cookies and returns signed out instead of a 503 loop', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    completeConfiguration();
    mocks.createServerClient.mockImplementation(
      (
        _url: string,
        _key: string,
        options: {
          cookies: {
            setAll: (
              cookies: Array<{
                name: string;
                value: string;
                options?: { path?: string; maxAge?: number };
              }>,
            ) => void;
          };
        },
      ) => {
        options.cookies.setAll([
          { name: 'sb-session', value: '', options: { path: '/', maxAge: 0 } },
        ]);
        return {
          auth: {
            getUser: vi.fn(async () => ({
              data: { user: null },
              error: { code: 'session_expired' },
            })),
          },
        };
      },
    );

    const response = await proxy(request('/api/scoreboard'));

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toContain('sb-session=');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('forwards a refreshed Supabase cookie to the current route and the browser', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    completeConfiguration();
    mocks.createServerClient.mockImplementation(
      (
        _url: string,
        _key: string,
        options: {
          cookies: {
            setAll: (
              cookies: Array<{
                name: string;
                value: string;
                options?: { path?: string };
              }>,
            ) => void;
          };
        },
      ) => {
        options.cookies.setAll([
          { name: 'sb-session', value: 'refreshed-token', options: { path: '/' } },
        ]);
        return {
          auth: {
            getUser: vi.fn(async () => ({
              data: { user: { id: 'auth-user-1', email: 'jason@example.com' } },
              error: null,
            })),
          },
        };
      },
    );

    const response = await proxy(
      new NextRequest('https://ops.yulelovelights.com/scoreboard', {
        headers: { cookie: 'sb-session=stale-token' },
      }),
    );

    expect(response.headers.get('x-middleware-request-cookie')).toContain(
      'sb-session=refreshed-token',
    );
    expect(response.headers.get('set-cookie')).toContain('sb-session=refreshed-token');
  });

  it('keeps GHL customer search and Twilio token minting behind staff auth', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    completeConfiguration();
    mocks.createServerClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
      },
    });

    for (const path of ['/api/ghl/contacts/search', '/api/twilio/token']) {
      const response = await proxy(request(path));
      expect(response.status).toBe(401);
    }

    expect(mocks.createServerClient).toHaveBeenCalledTimes(2);
  });

  it('allows only a configured, signed-in actor with the declared capability', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    completeConfiguration();
    signedIn();

    const response = await proxy(request('/scoreboard'));

    expect(mocks.resolveHubActor).toHaveBeenCalledWith({
      id: 'auth-user-1',
      email: 'jason@example.com',
      identitySource: 'hub',
    });
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('passes a phone-only Supabase session to the immutable actor resolver', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    completeConfiguration();
    signedIn(null);

    const response = await proxy(request('/scoreboard'));

    expect(mocks.resolveHubActor).toHaveBeenCalledWith({ id: 'auth-user-1', identitySource: 'hub' });
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('uses the Quote Tool Auth session only when explicitly selected and maps its source', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'preview');
    completeConfiguration();
    vi.stubEnv('NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE', 'quote_tool');
    vi.stubEnv('NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL', 'https://chhntsbnbofyqrpivuog.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY', 'sb_publishable_1234567890abcdefghij');
    signedIn();

    const response = await proxy(request('/scoreboard'));

    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(mocks.createServerClient).toHaveBeenCalledWith(
      'https://chhntsbnbofyqrpivuog.supabase.co/',
      'sb_publishable_1234567890abcdefghij',
      expect.any(Object),
    );
    expect(mocks.resolveHubActor).toHaveBeenCalledWith({
      id: 'auth-user-1',
      email: 'jason@example.com',
      identitySource: 'quote_tool',
    });
  });

  it('fails closed at the request boundary when Quote Tool Auth is selected in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    completeConfiguration();
    vi.stubEnv('NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE', 'quote_tool');
    vi.stubEnv('NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL', 'https://chhntsbnbofyqrpivuog.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY', 'sb_publishable_1234567890abcdefghij');

    const response = await proxy(request('/scoreboard'));

    expect(response.status).toBe(503);
    expect(await response.text()).toBe('Authentication is temporarily unavailable.');
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.resolveHubActor).not.toHaveBeenCalled();
  });

  it('fails closed when staging phone auth is enabled without Turnstile configuration', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'preview');
    completeConfiguration();
    vi.stubEnv('HUB_PHONE_AUTH_STAGING_ENABLED', 'true');

    const response = await proxy(request('/scoreboard'));

    expect(response.status).toBe(503);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.resolveHubActor).not.toHaveBeenCalled();
  });

  it('fails closed when the staging phone-auth flag is enabled in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    completeConfiguration();
    vi.stubEnv('HUB_PHONE_AUTH_STAGING_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'public-site-key');
    vi.stubEnv('VERCEL_ENV', 'production');

    const response = await proxy(request('/scoreboard'));

    expect(response.status).toBe(503);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.resolveHubActor).not.toHaveBeenCalled();
  });

  it('allows a verified staging phone session inside the 30-day maximum', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'preview');
    completeConfiguration();
    vi.stubEnv('HUB_PHONE_AUTH_STAGING_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'public-site-key');
    const authenticatedAt = Math.floor((Date.now() - 29 * 24 * 60 * 60 * 1000) / 1000);
    const signOut = vi.fn();
    mocks.createServerClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: {
            user: {
              id: 'auth-user-1',
              phone: '+16315550123',
              last_sign_in_at: new Date().toISOString(),
            },
          },
          error: null,
        })),
        getClaims: vi.fn(async () => ({
          data: {
            claims: {
              ...phoneJwtClaims({
                amr: [{ method: 'otp', timestamp: authenticatedAt }],
              }),
            },
          },
          error: null,
        })),
        signOut,
      },
    });

    const response = await proxy(request('/scoreboard'));

    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(signOut).not.toHaveBeenCalled();
    expect(mocks.resolveHubActor).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'auth-user-1', phone: '+16315550123' }),
    );
  });

  it('ends a staging phone session after the 30-day maximum before actor resolution', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'preview');
    completeConfiguration();
    vi.stubEnv('HUB_PHONE_AUTH_STAGING_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'public-site-key');
    const authenticatedAt = Math.floor((Date.now() - 31 * 24 * 60 * 60 * 1000) / 1000);
    const signOut = vi.fn(async () => ({ error: null }));
    mocks.createServerClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: {
            user: {
              id: 'auth-user-1',
              phone: '+16315550123',
              last_sign_in_at: new Date().toISOString(),
            },
          },
          error: null,
        })),
        getClaims: vi.fn(async () => ({
          data: {
            claims: {
              ...phoneJwtClaims({
                amr: [{ method: 'otp', timestamp: authenticatedAt }],
              }),
            },
          },
          error: null,
        })),
        signOut,
      },
    });

    const response = await proxy(request('/scoreboard'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://ops.yulelovelights.com/login');
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.resolveHubActor).not.toHaveBeenCalled();
  });

  it('rejects a password-authenticated session when staging phone mode is enabled', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'preview');
    completeConfiguration();
    vi.stubEnv('HUB_PHONE_AUTH_STAGING_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'public-site-key');
    const signOut = vi.fn(async () => ({ error: null }));
    mocks.createServerClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: {
            user: {
              id: 'auth-user-1',
              phone: '+16315550123',
              last_sign_in_at: new Date().toISOString(),
            },
          },
          error: null,
        })),
        getClaims: vi.fn(async () => ({
          data: {
            claims: {
              ...phoneJwtClaims({
                amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }],
              }),
            },
          },
          error: null,
        })),
        signOut,
      },
    });

    const response = await proxy(request('/scoreboard'));

    expect(response.status).toBe(307);
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.resolveHubActor).not.toHaveBeenCalled();
  });

  it('fails closed when auth or actor dependencies throw', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    completeConfiguration();
    mocks.createServerClient.mockImplementationOnce(() => {
      throw new Error('invalid client');
    });

    expect((await proxy(request('/scoreboard'))).status).toBe(503);

    signedIn();
    mocks.resolveHubActor.mockRejectedValueOnce(new Error('actor unavailable'));
    expect((await proxy(request('/scoreboard'))).status).toBe(503);
  });

  it('treats a returned auth dependency error as unavailable', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    completeConfiguration();
    mocks.createServerClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: { name: 'AuthApiError' },
        })),
      },
    });

    expect((await proxy(request('/api/scoreboard'))).status).toBe(503);
  });

  it('distinguishes a denied employee from an unavailable actor dependency', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    completeConfiguration();
    signedIn('stranger@example.com');
    mocks.resolveHubActor.mockResolvedValueOnce({
      status: 'denied',
      reason: 'not_staff',
    });

    const denied = await proxy(request('/api/scoreboard'));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: {
        code: 'ACCESS_DENIED',
        message: 'You do not have access to this resource.',
      },
    });

    mocks.resolveHubActor.mockResolvedValueOnce({ status: 'unavailable' });
    const unavailable = await proxy(request('/api/scoreboard'));
    expect(unavailable.status).toBe(503);
  });

  it('denies an authenticated actor without the route capability', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    completeConfiguration();
    signedIn('field@example.com');
    mocks.resolveHubActor.mockResolvedValueOnce(actorWith(['installer.navigation'], 'installer'));

    const response = await proxy(request('/api/scoreboard'));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'ACCESS_DENIED' } });
  });

  it('enforces method-specific capabilities on a mixed-access route', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    completeConfiguration();
    signedIn();

    expect((await proxy(new NextRequest('https://ops.yulelovelights.com/api/rubric'))).status).toBe(200);

    const write = await proxy(
      new NextRequest('https://ops.yulelovelights.com/api/rubric', { method: 'POST' }),
    );
    expect(write.status).toBe(403);

    mocks.resolveHubActor.mockResolvedValueOnce(
      actorWith(['office.coaching.settings.manage'], 'owner_admin'),
    );
    const ownerWrite = await proxy(
      new NextRequest('https://ops.yulelovelights.com/api/rubric', { method: 'POST' }),
    );
    expect(ownerWrite.headers.get('x-middleware-next')).toBe('1');
  });

  it('denies unknown routes and undeclared methods instead of inheriting a prefix policy', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    completeConfiguration();

    expect((await proxy(request('/api/health/private'))).status).toBe(403);
    expect(
      (
        await proxy(
          new NextRequest('https://ops.yulelovelights.com/api/health', { method: 'POST' }),
        )
      ).status,
    ).toBe(403);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.resolveHubActor).not.toHaveBeenCalled();
  });

  it('strips caller-supplied actor headers before forwarding an authorized request', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    completeConfiguration();
    signedIn();

    const response = await proxy(
      new NextRequest('https://ops.yulelovelights.com/scoreboard', {
        headers: {
          'x-yll-actor-id': 'spoofed-owner',
          'x-yll-actor-role': 'owner_admin',
          'x-safe-header': 'preserved',
        },
      }),
    );

    expect(response.headers.get('x-middleware-request-x-yll-actor-id')).toBeNull();
    expect(response.headers.get('x-middleware-request-x-yll-actor-role')).toBeNull();
    expect(response.headers.get('x-middleware-request-x-safe-header')).toBe('preserved');
  });

  it('does not exclude dotted dynamic identifiers from the proxy matcher', () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);

    expect(matcher.test('/api/leads/example.png')).toBe(true);
    expect(matcher.test('/call/customer.jpg')).toBe(true);
    expect(matcher.test('/favicon.ico')).toBe(true);
    expect(matcher.test('/_next/static/chunk.js')).toBe(false);
  });
});
