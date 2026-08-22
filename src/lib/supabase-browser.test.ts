import { afterEach, describe, expect, it, vi } from 'vitest';

const { createBrowserClient } = vi.hoisted(() => ({
  createBrowserClient: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({ createBrowserClient }));

import { getSupabaseBrowserClient } from './supabase-browser';

const browserKey = 'sb_publishable_1234567890abcdefghij';
const hubUrl = 'https://mjmociuxxxwxvasnpxav.supabase.co';
const quoteUrl = 'https://chhntsbnbofyqrpivuog.supabase.co';

describe('getSupabaseBrowserClient', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    createBrowserClient.mockReset();
  });

  it('uses the Hub Auth project by default', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', hubUrl);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', browserKey);

    getSupabaseBrowserClient();

    expect(createBrowserClient).toHaveBeenCalledWith(
      `${hubUrl}/`,
      browserKey,
    );
  });

  it('uses only the separately configured Quote Tool public Auth project when selected', () => {
    vi.stubEnv('NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE', 'quote_tool');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', hubUrl);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', browserKey);
    vi.stubEnv('NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL', quoteUrl);
    vi.stubEnv('NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY', browserKey);

    getSupabaseBrowserClient();

    expect(createBrowserClient).toHaveBeenCalledWith(
      `${quoteUrl}/`,
      browserKey,
    );
    expect(createBrowserClient).not.toHaveBeenCalledWith(
      `${hubUrl}/`,
      browserKey,
    );
  });

  it('fails closed for an unknown source or missing selected credentials', () => {
    vi.stubEnv('NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE', 'unknown');
    expect(getSupabaseBrowserClient()).toBeNull();

    vi.stubEnv('NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE', 'quote_tool');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', hubUrl);
    vi.stubEnv('NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL', quoteUrl);
    vi.stubEnv('NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY', '');
    expect(getSupabaseBrowserClient()).toBeNull();
    expect(createBrowserClient).not.toHaveBeenCalled();
  });

  it('refuses a server-only key even when the Quote Tool source is selected', () => {
    vi.stubEnv('NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE', 'quote_tool');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', hubUrl);
    vi.stubEnv('NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL', quoteUrl);
    vi.stubEnv('NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY', 'sb_secret_1234567890abcdefghij');

    expect(getSupabaseBrowserClient()).toBeNull();
    expect(createBrowserClient).not.toHaveBeenCalled();
  });

  it('rejects noncanonical project URLs, same-project Quote Auth, and normalized sources', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://credential-capture.example.com');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', browserKey);
    expect(getSupabaseBrowserClient()).toBeNull();

    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', hubUrl);
    vi.stubEnv('NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE', 'quote_tool');
    vi.stubEnv('NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL', hubUrl);
    vi.stubEnv('NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY', browserKey);
    expect(getSupabaseBrowserClient()).toBeNull();

    vi.stubEnv('NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE', ' QUOTE_TOOL ');
    vi.stubEnv('NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL', quoteUrl);
    expect(getSupabaseBrowserClient()).toBeNull();
    expect(createBrowserClient).not.toHaveBeenCalled();
  });

  it('rejects a distinct but non-frozen Quote Tool Auth project', () => {
    vi.stubEnv('NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE', 'quote_tool');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', hubUrl);
    vi.stubEnv(
      'NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL',
      'https://bcdefghijklmnopqrstu.supabase.co',
    );
    vi.stubEnv('NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY', browserKey);

    expect(getSupabaseBrowserClient()).toBeNull();
    expect(createBrowserClient).not.toHaveBeenCalled();
  });

  it('rejects a canonical but non-frozen Hub project', () => {
    vi.stubEnv(
      'NEXT_PUBLIC_SUPABASE_URL',
      'https://bcdefghijklmnopqrstu.supabase.co',
    );
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', browserKey);

    expect(getSupabaseBrowserClient()).toBeNull();
    expect(createBrowserClient).not.toHaveBeenCalled();
  });
});
