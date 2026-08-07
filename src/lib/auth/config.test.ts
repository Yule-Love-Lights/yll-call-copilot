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
});
