// Browser-side Supabase client for auth (sign-in / sign-out). Uses the anon
// key only — the service role key never reaches the browser. Returns null
// when not configured so callers can degrade gracefully, same convention as
// getSupabaseServerClient().

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isBrowserSafeSupabaseKey } from './auth/publicSupabaseKey';
import {
  matchesKnownHubSupabaseProject,
  matchesFrozenQuoteToolAuthSupabaseProject,
  normalizeHostedSupabaseProjectUrl,
} from './auth/publicSupabaseConfig.mjs';

export function getSupabaseBrowserClient(): SupabaseClient | null {
  const source = process.env.NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE ?? 'hub';
  if (source !== 'hub' && source !== 'quote_tool') return null;
  const hubUrl = normalizeHostedSupabaseProjectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const url = source === 'quote_tool'
    ? normalizeHostedSupabaseProjectUrl(process.env.NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL)
    : hubUrl;
  const anonKey = source === 'quote_tool'
    ? process.env.NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY?.trim()
    : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (
    !hubUrl
    || !matchesKnownHubSupabaseProject(hubUrl)
    || !url
    || (source === 'quote_tool' && url === hubUrl)
    || (source === 'quote_tool' && !matchesFrozenQuoteToolAuthSupabaseProject(url))
    || !anonKey
    || !isBrowserSafeSupabaseKey(anonKey)
  ) return null;
  return createBrowserClient(url, anonKey);
}
