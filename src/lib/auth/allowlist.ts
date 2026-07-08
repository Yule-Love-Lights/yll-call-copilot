// Staff allowlist decision: a signed-in user must also have a row in
// app_users to use the app. Factored out of the proxy so the decision logic
// is unit-testable without request plumbing. Per-request query, no caching —
// fine at 2-4 staff users.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '../supabase';

export type AllowlistDecision = 'allowed' | 'denied' | 'unconfigured';

// The client parameter exists for tests; production callers use the default.
export async function checkAllowlist(
  email: string | null | undefined,
  client: SupabaseClient | null = getSupabaseServerClient(),
): Promise<AllowlistDecision> {
  // No Supabase env means the whole app runs unauthenticated (dev
  // degradation, same philosophy as the rest of the app).
  if (!client) return 'unconfigured';
  if (!email) return 'denied';

  // Supabase auth stores emails lowercased; create-user.mjs writes app_users
  // emails lowercased too, so an exact match on the lowercased value is safe.
  const { data, error } = await client
    .from('app_users')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  // Fail closed: a query error denies access rather than letting an
  // unverified user through.
  if (error || !data) return 'denied';
  return 'allowed';
}

// The actual access policy src/proxy.ts consults. 'unconfigured' means
// checkAllowlist() could not even run the check (getSupabaseServerClient()
// returned null — SUPABASE_SERVICE_ROLE_KEY missing or wrong). proxy.ts only
// reaches checkAllowlist() after its OWN separate bailout for "the whole app
// has zero Supabase config" (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY both absent),
// so by the time this runs, a real signed-in session already exists —
// 'unconfigured' here can only be the narrower, non-legitimate case of a
// broken service-role key or a failed query, which must deny access the
// same as an explicit 'denied', not silently grant it.
export function shouldDenyAccess(decision: AllowlistDecision): boolean {
  return decision === 'denied' || decision === 'unconfigured';
}
