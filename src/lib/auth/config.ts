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

// Read each variable as a LITERAL `process.env.X` member expression. Next
// inlines `NEXT_PUBLIC_*` at build time by substituting exactly that syntax, so
// reading them off a `process.env` OBJECT REFERENCE (the previous
// `environment: ServerAuthEnvironment = process.env` default) yields undefined
// in bundles that rely on the substitution — the middleware bundle does. The
// route-handler bundle kept them at runtime, which is why /api/health reported
// `supabase: true` while proxy.ts simultaneously 503'd every non-public route
// through this same function for eight days (2026-08-08 to 2026-08-16): all
// crons dark, no calls captured. The explicit `environment` parameter stays,
// because the tests inject fixtures through it; only the DEFAULT changed.
function readServerAuthEnvironment(): ServerAuthEnvironment {
  return {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

export function resolveServerAuthConfiguration(
  environment: ServerAuthEnvironment = readServerAuthEnvironment(),
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
