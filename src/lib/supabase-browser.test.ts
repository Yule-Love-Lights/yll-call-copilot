import { afterEach, describe, expect, it, vi } from 'vitest';

const { createBrowserClient } = vi.hoisted(() => ({
  createBrowserClient: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({ createBrowserClient }));

import { getSupabaseBrowserClient } from './supabase-browser';

const browserKey = 'sb_publishable_1234567890abcdefghij';

describe('getSupabaseBrowserClient', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    createBrowserClient.mockReset();
  });

  it('uses the Hub Auth project by default', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://hub-auth.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', browserKey);

    getSupabaseBrowserClient();

    expect(createBrowserClient).toHaveBeenCalledWith(
      'https://hub-auth.supabase.co',
      browserKey,
    );
  });

  it('uses only the separately configured Quote Tool public Auth project when selected', () => {
    vi.stubEnv('NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE', 'quote_tool');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://hub-auth.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', browserKey);
    vi.stubEnv('NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL', 'https://quote-auth.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY', browserKey);

    getSupabaseBrowserClient();

    expect(createBrowserClient).toHaveBeenCalledWith(
      'https://quote-auth.supabase.co',
      browserKey,
    );
    expect(createBrowserClient).not.toHaveBeenCalledWith(
      'https://hub-auth.supabase.co',
      browserKey,
    );
  });

  it('fails closed for an unknown source or missing selected credentials', () => {
    vi.stubEnv('NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE', 'unknown');
    expect(getSupabaseBrowserClient()).toBeNull();

    vi.stubEnv('NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE', 'quote_tool');
    vi.stubEnv('NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL', 'https://quote-auth.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY', '');
    expect(getSupabaseBrowserClient()).toBeNull();
    expect(createBrowserClient).not.toHaveBeenCalled();
  });

  it('refuses a server-only key even when the Quote Tool source is selected', () => {
    vi.stubEnv('NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE', 'quote_tool');
    vi.stubEnv('NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL', 'https://quote-auth.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY', 'sb_secret_1234567890abcdefghij');

    expect(getSupabaseBrowserClient()).toBeNull();
    expect(createBrowserClient).not.toHaveBeenCalled();
  });
});
