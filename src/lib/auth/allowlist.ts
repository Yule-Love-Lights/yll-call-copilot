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
  // The proxy treats this as dependency unavailability and fails closed.
  if (!client) return 'unconfigured';
  if (!email) return 'denied';

  // Supabase auth stores emails lowercased; create-user.mjs writes app_users
  // emails lowercased too, so an exact match on the lowercased value is safe.
  const { data, error } = await client
    .from('app_users')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  // Keep dependency failure distinct from a legitimate missing row so the
  // proxy can return a generic 503 instead of misreporting it as access denial.
  if (error) return 'unconfigured';
  if (!data) return 'denied';
  return 'allowed';
}

// The actual access policy src/proxy.ts consults. 'unconfigured' means
// checkAllowlist() could not even run the check (getSupabaseServerClient()
// returned null or the allowlist dependency failed). It must deny access just
// like an explicit rejection, while the proxy presents it as service
// unavailability rather than revealing internal configuration details.
export function shouldDenyAccess(decision: AllowlistDecision): boolean {
  return decision === 'denied' || decision === 'unconfigured';
}
