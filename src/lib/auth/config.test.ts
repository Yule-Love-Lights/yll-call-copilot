import { describe, expect, it } from 'vitest';
import {
  resolveIdentityAuthConfiguration,
  resolveServerAuthConfiguration,
  type ServerAuthEnvironment,
} from './config';

const browserKey = 'sb_publishable_1234567890abcdefghij';
const hubProjectUrl = 'https://mjmociuxxxwxvasnpxav.supabase.co';
const stagingHubProjectUrl = 'https://ewbtkrytrnerypdkuimd.supabase.co';
const quoteProjectUrl = 'https://chhntsbnbofyqrpivuog.supabase.co';

const completeEnvironment: ServerAuthEnvironment = {
  NODE_ENV: 'production',
  VERCEL_ENV: 'production',
  NEXT_PUBLIC_SUPABASE_URL: hubProjectUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: browserKey,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};
const previewEnvironment: ServerAuthEnvironment = {
  ...completeEnvironment,
  VERCEL_ENV: 'preview',
  NEXT_PUBLIC_SUPABASE_URL: stagingHubProjectUrl,
};

describe('resolveServerAuthConfiguration', () => {
  it('returns only the validated configuration when every dependency is present', () => {
    expect(resolveServerAuthConfiguration(completeEnvironment)).toEqual({
      ok: true,
      url: `${hubProjectUrl}/`,
      anonKey: browserKey,
      serviceRoleKey: 'service-role-key',
    });
  });

  it.each([
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ] as const)('fails closed when %s is missing, empty, or whitespace', key => {
    for (const value of [undefined, '', '   ']) {
      const environment = { ...completeEnvironment, [key]: value };
      expect(resolveServerAuthConfiguration(environment)).toEqual({
        ok: false,
        code: 'AUTH_CONFIGURATION_UNAVAILABLE',
      });
    }
  });

  it('rejects malformed, non-HTTPS, and noncanonical production URLs', () => {
    for (const url of [
      'not-a-url',
      'http://abcdefghijklmnopqrst.supabase.co',
      'ftp://abcdefghijklmnopqrst.supabase.co',
      'https://credential-capture.example.com',
      'https://short.supabase.co',
      `${hubProjectUrl}/rest/v1`,
    ]) {
      expect(
        resolveServerAuthConfiguration({
          ...completeEnvironment,
          NEXT_PUBLIC_SUPABASE_URL: url,
        }),
      ).toEqual({ ok: false, code: 'AUTH_CONFIGURATION_UNAVAILABLE' });
    }
  });

  it('binds Vercel production and preview to their frozen Hub projects', () => {
    expect(resolveServerAuthConfiguration({
      ...completeEnvironment,
      NEXT_PUBLIC_SUPABASE_URL: stagingHubProjectUrl,
    })).toEqual({ ok: false, code: 'AUTH_CONFIGURATION_UNAVAILABLE' });
    expect(resolveServerAuthConfiguration({
      ...previewEnvironment,
      NEXT_PUBLIC_SUPABASE_URL: hubProjectUrl,
    })).toEqual({ ok: false, code: 'AUTH_CONFIGURATION_UNAVAILABLE' });
    expect(resolveServerAuthConfiguration({
      ...completeEnvironment,
      VERCEL_ENV: undefined,
      NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    })).toEqual({ ok: false, code: 'AUTH_CONFIGURATION_UNAVAILABLE' });
  });

  it('accepts HTTP only for a loopback Supabase instance under development', () => {
    expect(
      resolveServerAuthConfiguration({
        ...completeEnvironment,
        NODE_ENV: 'development',
        VERCEL_ENV: undefined,
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      }),
    ).toMatchObject({ ok: true, url: 'http://127.0.0.1:54321/' });

    expect(
      resolveServerAuthConfiguration({
        ...completeEnvironment,
        NODE_ENV: 'development',
        VERCEL_ENV: undefined,
        NEXT_PUBLIC_SUPABASE_URL: 'http://[::1]:54321',
      }),
    ).toMatchObject({ ok: true, url: 'http://[::1]:54321/' });

    expect(
      resolveServerAuthConfiguration({
        ...completeEnvironment,
        NODE_ENV: 'development',
        VERCEL_ENV: undefined,
        NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.internal:54321',
      }),
    ).toEqual({ ok: false, code: 'AUTH_CONFIGURATION_UNAVAILABLE' });
  });

  // The eight-day outage (2026-08-08 to 2026-08-16) lived entirely in the
  // DEFAULT argument: every existing test above injects an environment object,
  // so none of them ever exercised how the function reads real configuration.
  // It resolved `process.env` as an OBJECT REFERENCE, which loses the
  // build-time substitution Next applies to NEXT_PUBLIC_* literals, so the
  // middleware bundle saw undefined and fail-closed 503'd every non-public
  // route -- including the crons. These pin the no-argument path.
  it('resolves from the real process.env when no environment is injected', () => {
    const saved = {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      service: process.env.SUPABASE_SERVICE_ROLE_KEY,
      vercel: process.env.VERCEL_ENV,
    };
    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = hubProjectUrl;
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = browserKey;
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
      process.env.VERCEL_ENV = 'production';
      expect(resolveServerAuthConfiguration()).toMatchObject({
        ok: true,
        url: `${hubProjectUrl}/`,
        anonKey: browserKey,
        serviceRoleKey: 'service-key',
      });
    } finally {
      if (saved.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
      if (saved.anon === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = saved.anon;
      if (saved.service === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = saved.service;
      if (saved.vercel === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = saved.vercel;
    }
  });

  it('still fails closed on the no-argument path when a variable is absent', () => {
    const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = hubProjectUrl;
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = browserKey;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      expect(resolveServerAuthConfiguration()).toEqual({
        ok: false,
        code: 'AUTH_CONFIGURATION_UNAVAILABLE',
      });
    } finally {
      if (saved === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
    }
  });
});

describe('resolveIdentityAuthConfiguration', () => {
  it('uses the Hub identity project unless an explicit external source is selected', () => {
    expect(resolveIdentityAuthConfiguration(completeEnvironment)).toEqual({
      ok: true,
      source: 'hub',
      url: `${hubProjectUrl}/`,
      anonKey: browserKey,
    });
  });

  it('uses a distinct Quote Tool Auth project only with every explicit public value', () => {
    expect(resolveIdentityAuthConfiguration({
      ...previewEnvironment,
      NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE: 'quote_tool',
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL: quoteProjectUrl,
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY: browserKey,
    })).toEqual({
      ok: true,
      source: 'quote_tool',
      url: `${quoteProjectUrl}/`,
      anonKey: browserKey,
    });
  });

  it('allows Quote Tool identity in production only with the explicit server-side release gate', () => {
    expect(resolveIdentityAuthConfiguration({
      ...completeEnvironment,
      NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE: 'quote_tool',
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL: quoteProjectUrl,
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY: browserKey,
      HUB_QUOTE_TOOL_IDENTITY_PRODUCTION_ENABLED: 'true',
    })).toEqual({
      ok: true,
      source: 'quote_tool',
      url: `${quoteProjectUrl}/`,
      anonKey: browserKey,
    });
  });

  it.each([
    { NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL: undefined },
    { NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL: stagingHubProjectUrl },
    { NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL: 'http://bcdefghijklmnopqrstu.supabase.co' },
    { NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL: 'https://bcdefghijklmnopqrstu.supabase.co' },
    { NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL: 'https://credential-capture.example.com' },
    { NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY: '   ' },
    { NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE: 'anything_else' },
    { NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE: 'QUOTE_TOOL' },
    { NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE: ' quote_tool ' },
  ])('fails closed for an incomplete or invalid external identity configuration: %#', overrides => {
    expect(resolveIdentityAuthConfiguration({
      ...previewEnvironment,
      NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE: 'quote_tool',
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL: quoteProjectUrl,
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY: browserKey,
      ...overrides,
    })).toEqual({ ok: false, code: 'AUTH_CONFIGURATION_UNAVAILABLE' });
  });

  it.each([undefined, 'production', 'Preview', ' preview '])(
    'fails closed when Quote Tool Auth is selected without the exact preview environment or production release gate: %s',
    vercelEnvironment => {
    expect(resolveIdentityAuthConfiguration({
      ...previewEnvironment,
      VERCEL_ENV: vercelEnvironment,
        NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE: 'quote_tool',
        NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL: quoteProjectUrl,
        NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY: browserKey,
      })).toEqual({ ok: false, code: 'AUTH_CONFIGURATION_UNAVAILABLE' });
    },
  );

  it('rejects an elevated key selected for browser authentication', () => {
    expect(resolveIdentityAuthConfiguration({
      ...previewEnvironment,
      NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE: 'quote_tool',
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL: quoteProjectUrl,
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY: 'sb_secret_1234567890abcdefghij',
    })).toEqual({ ok: false, code: 'AUTH_CONFIGURATION_UNAVAILABLE' });
  });
});
