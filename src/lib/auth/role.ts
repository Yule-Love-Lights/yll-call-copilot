// Resolves the signed-in staff member's app_users role for routes that gate
// on it. 'rep' is the default and least-privileged role; anything else
// (owner, admin) may read team-wide coaching data and edit shared settings.
// A missing row, missing email, or lookup failure resolves to 'rep' so a
// gap fails closed. Duplicated byte-identical across sibling branches the
// same way src/lib/quoteTool.ts is; git merges identical additions cleanly.

import type { SupabaseClient } from '@supabase/supabase-js';

export async function resolveStaffRole(supabase: SupabaseClient, email: string | null): Promise<string> {
  if (!email) return 'rep';
  const { data, error } = await supabase
    .from('app_users')
    .select('role')
    .eq('email', email)
    .maybeSingle();
  if (error || !data) return 'rep';
  const role = (data as { role?: string }).role;
  return role && role.trim() ? role : 'rep';
}
