import { describe, expect, it } from 'vitest';
import {
  resolveServerAuthConfiguration,
  type ServerAuthEnvironment,
} from './config';

const completeEnvironment: ServerAuthEnvironment = {
  NODE_ENV: 'production',
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

describe('resolveServerAuthConfiguration', () => {
  it('returns only the validated configuration when every dependency is present', () => {
    expect(resolveServerAuthConfiguration(completeEnvironment)).toEqual({
      ok: true,
      url: 'https://project.supabase.co/',
      anonKey: 'anon-key',
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

  it('rejects malformed and non-HTTPS production URLs', () => {
    for (const url of ['not-a-url', 'http://project.supabase.co', 'ftp://project.supabase.co']) {
      expect(
        resolveServerAuthConfiguration({
          ...completeEnvironment,
          NEXT_PUBLIC_SUPABASE_URL: url,
        }),
      ).toEqual({ ok: false, code: 'AUTH_CONFIGURATION_UNAVAILABLE' });
    }
  });

  it('accepts HTTP only for a loopback Supabase instance under development', () => {
    expect(
      resolveServerAuthConfiguration({
        ...completeEnvironment,
        NODE_ENV: 'development',
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      }),
    ).toMatchObject({ ok: true, url: 'http://127.0.0.1:54321/' });

    expect(
      resolveServerAuthConfiguration({
        ...completeEnvironment,
        NODE_ENV: 'development',
        NEXT_PUBLIC_SUPABASE_URL: 'http://[::1]:54321',
      }),
    ).toMatchObject({ ok: true, url: 'http://[::1]:54321/' });

    expect(
      resolveServerAuthConfiguration({
        ...completeEnvironment,
        NODE_ENV: 'development',
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
    };
    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
      expect(resolveServerAuthConfiguration()).toMatchObject({
        ok: true,
        url: 'https://example.supabase.co/',
        anonKey: 'anon-key',
        serviceRoleKey: 'service-key',
      });
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = saved.anon;
      process.env.SUPABASE_SERVICE_ROLE_KEY = saved.service;
    }
  });

  it('still fails closed on the no-argument path when a variable is absent', () => {
    const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
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
