// Browser-side Supabase client for auth (sign-in / sign-out). Uses the anon
// key only — the service role key never reaches the browser. Returns null
// when not configured so callers can degrade gracefully, same convention as
// getSupabaseServerClient().

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

export function getSupabaseBrowserClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return createBrowserClient(url, anonKey);
}
