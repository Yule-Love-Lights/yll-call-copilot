// Coverage for the staff allowlist decision helper. Style follows
// ghl/client.test.ts — we mock the Supabase client (and env vars for the
// default-client path); no live Supabase calls.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkAllowlist, shouldDenyAccess } from './allowlist';

function fakeClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn(async () => result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select, eq }));
  const client = { from } as unknown as SupabaseClient;
  return { client, from, select, eq };
}

describe('checkAllowlist', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns allowed when the email has an app_users row', async () => {
    const { client } = fakeClient({ data: { id: 'u1' }, error: null });
    expect(await checkAllowlist('jason@example.com', client)).toBe('allowed');
  });

  it('returns denied when the email is not in app_users', async () => {
    const { client } = fakeClient({ data: null, error: null });
    expect(await checkAllowlist('stranger@example.com', client)).toBe('denied');
  });

  it('returns denied (fail closed) when the query errors', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'boom' } });
    expect(await checkAllowlist('jason@example.com', client)).toBe('denied');
  });

  it('returns denied when the signed-in user has no email', async () => {
    const { client, from } = fakeClient({ data: { id: 'u1' }, error: null });
    expect(await checkAllowlist(null, client)).toBe('denied');
    expect(await checkAllowlist(undefined, client)).toBe('denied');
    expect(await checkAllowlist('', client)).toBe('denied');
    expect(from).not.toHaveBeenCalled();
  });

  it('lowercases the email before matching', async () => {
    const { client, eq } = fakeClient({ data: { id: 'u1' }, error: null });
    await checkAllowlist('Jason@Example.COM', client);
    expect(eq).toHaveBeenCalledWith('email', 'jason@example.com');
  });

  it('returns unconfigured when no client is available (explicit null)', async () => {
    expect(await checkAllowlist('jason@example.com', null)).toBe('unconfigured');
  });

  it('returns unconfigured via the default client when Supabase env is missing', async () => {
    const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      expect(await checkAllowlist('jason@example.com')).toBe('unconfigured');
    } finally {
      if (savedUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
      if (savedKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
    }
  });
});

// H4: src/proxy.ts used to only special-case 'denied', letting 'unconfigured'
// fall through to full access. By the time proxy.ts ever calls
// checkAllowlist(), it has already confirmed NEXT_PUBLIC_SUPABASE_URL/
// ANON_KEY exist (its own separate "app has zero Supabase config" bailout
// runs first) — so 'unconfigured' at that point can only mean the narrower,
// non-legitimate case: SUPABASE_SERVICE_ROLE_KEY is missing, wrong, or the
// allowlist query itself errored. That must deny, not grant, access. This is
// the actual policy decision proxy.ts consults; it must never quietly
// change to fail open again.
describe('shouldDenyAccess', () => {
  it('denies an explicit "denied" decision', () => {
    expect(shouldDenyAccess('denied')).toBe(true);
  });

  it('denies "unconfigured" — the fail-open gap this closes', () => {
    expect(shouldDenyAccess('unconfigured')).toBe(true);
  });

  it('allows "allowed"', () => {
    expect(shouldDenyAccess('allowed')).toBe(false);
  });
});
