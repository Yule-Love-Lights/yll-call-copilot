// Server-side Supabase authentication configuration. This module validates
// values at request time so a secretless `next build` can still complete while
// deployed requests fail closed when authentication cannot be enforced.

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export type ServerAuthEnvironment = {
  NODE_ENV?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

export type ServerAuthConfiguration =
  | {
      ok: true;
      url: string;
      anonKey: string;
      serviceRoleKey: string;
    }
  | {
      ok: false;
      code: 'AUTH_CONFIGURATION_UNAVAILABLE';
    };

function nonBlank(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function validSupabaseUrl(rawUrl: string, nodeEnvironment: string | undefined): string | null {
  try {
    const parsed = new URL(rawUrl);
    const localDevelopmentHttp =
      nodeEnvironment === 'development' &&
      parsed.protocol === 'http:' &&
      LOOPBACK_HOSTNAMES.has(parsed.hostname);

    if (parsed.protocol !== 'https:' && !localDevelopmentHttp) return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function resolveServerAuthConfiguration(
  environment: ServerAuthEnvironment = process.env,
): ServerAuthConfiguration {
  const rawUrl = nonBlank(environment.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = nonBlank(environment.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const serviceRoleKey = nonBlank(environment.SUPABASE_SERVICE_ROLE_KEY);
  const url = rawUrl ? validSupabaseUrl(rawUrl, environment.NODE_ENV) : null;

  if (!url || !anonKey || !serviceRoleKey) {
    return { ok: false, code: 'AUTH_CONFIGURATION_UNAVAILABLE' };
  }

  return { ok: true, url, anonKey, serviceRoleKey };
}
