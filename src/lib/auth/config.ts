// Server-side Supabase authentication configuration. This module validates
// values at request time so a secretless `next build` can still complete while
// deployed requests fail closed when authentication cannot be enforced.

import { isBrowserSafeSupabaseKey } from './publicSupabaseKey';
import {
  matchesFrozenHubSupabaseProject,
  matchesFrozenQuoteToolAuthSupabaseProject,
  normalizeHostedSupabaseProjectUrl,
} from './publicSupabaseConfig.mjs';

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export type ServerAuthEnvironment = {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE?: string;
  NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL?: string;
  NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY?: string;
  HUB_QUOTE_TOOL_IDENTITY_PRODUCTION_ENABLED?: string;
};

export type HubAuthIdentitySource = 'hub' | 'quote_tool';

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

export type IdentityAuthConfiguration =
  | {
      ok: true;
      source: HubAuthIdentitySource;
      url: string;
      anonKey: string;
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
  const hostedUrl = normalizeHostedSupabaseProjectUrl(rawUrl);
  if (hostedUrl) return hostedUrl;

  try {
    const parsed = new URL(rawUrl);
    const localDevelopmentHttp =
      nodeEnvironment === 'development' &&
      parsed.protocol === 'http:' &&
      LOOPBACK_HOSTNAMES.has(parsed.hostname) &&
      !parsed.username &&
      !parsed.password &&
      parsed.pathname === '/' &&
      !parsed.search &&
      !parsed.hash;

    return localDevelopmentHttp ? parsed.toString() : null;
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
    VERCEL_ENV: process.env.VERCEL_ENV,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE: process.env.NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE,
    NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL: process.env.NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL,
    NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY,
    HUB_QUOTE_TOOL_IDENTITY_PRODUCTION_ENABLED: process.env.HUB_QUOTE_TOOL_IDENTITY_PRODUCTION_ENABLED,
  };
}

export function resolveServerAuthConfiguration(
  environment: ServerAuthEnvironment = readServerAuthEnvironment(),
): ServerAuthConfiguration {
  const rawUrl = nonBlank(environment.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = nonBlank(environment.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const serviceRoleKey = nonBlank(environment.SUPABASE_SERVICE_ROLE_KEY);
  const url = rawUrl ? validSupabaseUrl(rawUrl, environment.NODE_ENV) : null;
  const localDevelopmentTarget = (() => {
    if (!url || environment.NODE_ENV !== 'development' || environment.VERCEL_ENV !== undefined) {
      return false;
    }
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(parsed.hostname);
    } catch {
      return false;
    }
  })();

  if (
    !url
    || !anonKey
    || !serviceRoleKey
    || (!localDevelopmentTarget
      && !matchesFrozenHubSupabaseProject(url, environment.VERCEL_ENV))
  ) {
    return { ok: false, code: 'AUTH_CONFIGURATION_UNAVAILABLE' };
  }

  return { ok: true, url, anonKey, serviceRoleKey };
}

// The Hub's data project remains authoritative for Hub roles, employees, and
// permissions. Staging may instead authenticate a browser session against the
// Quote Tool's existing Supabase Auth project, but only through an explicit
// source selection and a separate immutable employee mapping.
export function resolveIdentityAuthConfiguration(
  environment: ServerAuthEnvironment = readServerAuthEnvironment(),
): IdentityAuthConfiguration {
  const hub = resolveServerAuthConfiguration(environment);
  if (!hub.ok) return hub;

  const source = environment.NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE ?? 'hub';
  if (source === 'hub') {
    if (!isBrowserSafeSupabaseKey(hub.anonKey)) {
      return { ok: false, code: 'AUTH_CONFIGURATION_UNAVAILABLE' };
    }
    return { ok: true, source, url: hub.url, anonKey: hub.anonKey };
  }
  if (source !== 'quote_tool') {
    return { ok: false, code: 'AUTH_CONFIGURATION_UNAVAILABLE' };
  }
  const productionSourceEnabled =
    environment.VERCEL_ENV === 'production'
    && environment.HUB_QUOTE_TOOL_IDENTITY_PRODUCTION_ENABLED === 'true';
  if (environment.VERCEL_ENV !== 'preview' && !productionSourceEnabled) {
    return { ok: false, code: 'AUTH_CONFIGURATION_UNAVAILABLE' };
  }

  const quoteUrlRaw = nonBlank(environment.NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL);
  const quoteAnonKey = nonBlank(environment.NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY);
  const quoteUrl = quoteUrlRaw ? validSupabaseUrl(quoteUrlRaw, environment.NODE_ENV) : null;
  if (
    !quoteUrl
    || !quoteAnonKey
    || quoteUrl === hub.url
    || !matchesFrozenQuoteToolAuthSupabaseProject(quoteUrl)
    || !isBrowserSafeSupabaseKey(quoteAnonKey)
  ) {
    return { ok: false, code: 'AUTH_CONFIGURATION_UNAVAILABLE' };
  }

  return { ok: true, source, url: quoteUrl, anonKey: quoteAnonKey };
}
