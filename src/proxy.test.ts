import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  checkAllowlist: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: mocks.createServerClient,
}));

vi.mock('@/lib/auth/allowlist', () => ({
  checkAllowlist: mocks.checkAllowlist,
  shouldDenyAccess: (decision: string) =>
    decision === 'denied' || decision === 'unconfigured',
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
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
}

function signedIn(email = 'jason@example.com') {
  mocks.createServerClient.mockReturnValue({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { email } }, error: null })),
    },
  });
}

describe('root authentication proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkAllowlist.mockResolvedValue('allowed');
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
    expect(mocks.checkAllowlist).not.toHaveBeenCalled();
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

  it('blocks partial configuration before session or allowlist work begins', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    completeConfiguration();
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');

    const response = await proxy(request('/api/ghl/contacts/search'));

    expect(response.status).toBe(503);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.checkAllowlist).not.toHaveBeenCalled();
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

    const response = await proxy(request('/api/webhooks/ghl'));

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

  it('allows only a configured, signed-in, allowlisted request', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    completeConfiguration();
    signedIn();

    const response = await proxy(request('/scoreboard'));

    expect(mocks.checkAllowlist).toHaveBeenCalledWith('jason@example.com');
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('fails closed when auth or allowlist dependencies throw', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    completeConfiguration();
    mocks.createServerClient.mockImplementationOnce(() => {
      throw new Error('invalid client');
    });

    expect((await proxy(request('/scoreboard'))).status).toBe(503);

    signedIn();
    mocks.checkAllowlist.mockRejectedValueOnce(new Error('allowlist unavailable'));
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

  it('distinguishes a denied employee from an unavailable allowlist', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    completeConfiguration();
    signedIn('stranger@example.com');
    mocks.checkAllowlist.mockResolvedValueOnce('denied');

    const denied = await proxy(request('/api/scoreboard'));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'Not on the staff list' });

    mocks.checkAllowlist.mockResolvedValueOnce('unconfigured');
    const unavailable = await proxy(request('/api/scoreboard'));
    expect(unavailable.status).toBe(503);
  });

  it('does not exclude dotted dynamic identifiers from the proxy matcher', () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);

    expect(matcher.test('/api/leads/example.png')).toBe(true);
    expect(matcher.test('/call/customer.jpg')).toBe(true);
    expect(matcher.test('/favicon.ico')).toBe(false);
    expect(matcher.test('/_next/static/chunk.js')).toBe(false);
  });
});
