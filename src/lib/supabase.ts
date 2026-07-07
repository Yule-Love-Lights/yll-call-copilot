// Server-side Supabase client factory. isSupabaseConfigured() lets the rest
// of the app degrade gracefully (health panel goes red, features no-op)
// instead of crashing when env vars are missing — same convention as the
// GHL client's isHighLevelConfigured().

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function isSupabaseConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// Server-only client using the service role key — full access, never expose
// to the browser. Returns null when not configured so callers can no-op
// instead of throwing.
export function getSupabaseServerClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
