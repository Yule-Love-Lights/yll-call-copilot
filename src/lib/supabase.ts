// Server-side Supabase client factories. Configuration is validated by the
// same strict request-time resolver used by the root proxy.

import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { resolveServerAuthConfiguration } from './auth/config';

// True when a Postgres/PostgREST error means "this table doesn't exist yet"
// — a migration may not be applied in every environment while its phase's
// code ships. Routes that touch its tables check this before returning a
// hard 500, so a missing migration degrades to a friendly "run the
// migration" response instead (same philosophy as isSupabaseConfigured()
// degrading gracefully on missing env).
//
// Two codes, not one: 42P01 is Postgres's own "undefined_table" (raised by a
// direct DB connection), but @supabase/supabase-js talks to Postgres through
// PostgREST, which instead answers a missing table with its own PGRST205
// ("Could not find the table ... in the schema cache") — confirmed live
// against a not-yet-migrated project (2026-07-08), where every route relying
// on this check was silently falling through to a hard 500 instead of its
// intended degrade message. Both are checked so that never happens again,
// regardless of which layer surfaces the error.
export function isMissingTableError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined;
  return code === '42P01' || code === 'PGRST205';
}

export function isSupabaseConfigured(): boolean {
  return resolveServerAuthConfiguration().ok;
}

// Server-only client using the service role key — full access, never expose
// to the browser. Returns null when not configured so callers can no-op
// instead of throwing.
export function getSupabaseServerClient(): SupabaseClient | null {
  const configuration = resolveServerAuthConfiguration();
  if (!configuration.ok) return null;
  return createClient(configuration.url, configuration.serviceRoleKey, {
    auth: { persistSession: false },
  });
}

// Auth-aware server client (anon key + the caller's session cookies) for
// server components and route handlers that need to know who is signed in.
// Data access keeps going through getSupabaseServerClient(); this one is for
// auth. cookies() is async in Next 16, hence the await.
export async function getSupabaseAuthServerClient(): Promise<SupabaseClient | null> {
  const configuration = resolveServerAuthConfiguration();
  if (!configuration.ok) return null;
  const cookieStore = await cookies();
  return createServerClient(configuration.url, configuration.anonKey, {
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
