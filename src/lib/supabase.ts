// Server-side Supabase client factories. isSupabaseConfigured() lets the rest
// of the app degrade gracefully (health panel goes red, features no-op)
// instead of crashing when env vars are missing — same convention as the
// GHL client's isHighLevelConfigured().

import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

// True when a Postgres/PostgREST error means "this table doesn't exist yet"
// (SQLSTATE 42P01) — migration 0003_knowledge.sql may not be applied in
// every environment while Phase 1.5 code ships. Routes that touch its tables
// check this before returning a hard 500, so a missing migration degrades to
// a friendly "run the migration" response instead (same philosophy as
// isSupabaseConfigured() degrading gracefully on missing env).
export function isMissingTableError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '42P01';
}

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

// Auth-aware server client (anon key + the caller's session cookies) for
// server components and route handlers that need to know who is signed in.
// Data access keeps going through getSupabaseServerClient(); this one is for
// auth. cookies() is async in Next 16, hence the await.
export async function getSupabaseAuthServerClient(): Promise<SupabaseClient | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server components cannot write cookies; the root proxy handles
          // session refresh, so swallowing here is the documented pattern.
        }
      },
    },
  });
}
