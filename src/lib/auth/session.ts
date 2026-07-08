// Resolves the signed-in staff member's email for routes that attribute an
// action to a person (claiming a lead, logging a call). Factored out for the
// same reason allowlist.ts is: a single seam the rest of the app reads
// through. No Supabase config means no session, same "auth degrades to
// nothing configured" convention as the rest of the app.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAuthServerClient } from '../supabase';

// `client` is undefined by default (fetches the real auth-cookie client);
// tests pass a mock directly. Can't default-initialize it with `await` (not
// allowed in a parameter initializer), hence the explicit undefined check.
export async function getSessionEmail(client?: SupabaseClient | null): Promise<string | null> {
  const supabase = client === undefined ? await getSupabaseAuthServerClient() : client;
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email ?? null;
}
