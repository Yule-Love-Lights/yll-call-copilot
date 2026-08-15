// Resolves the UUID-authorized employee's compatibility role for the legacy
// scoreboard visibility check. A query error, inactive employee, or no match
// resolves to null, which is the most private outcome.

import type { SupabaseClient } from '@supabase/supabase-js';
import { parseOpsEmployeeRole } from '@/lib/auth/capabilities';

export type ScoreboardRole = 'rep' | 'owner' | 'admin';

export async function resolveRepRole(
  email: string | null | undefined,
  client: SupabaseClient,
): Promise<ScoreboardRole | null> {
  if (!email) return null;
  const { data, error } = await client
    .from('ops_employees')
    .select('role, active')
    .eq('compatibility_email', email.toLowerCase())
    .maybeSingle();
  if (error || !data || (data as { active?: unknown }).active !== true) return null;
  const role = parseOpsEmployeeRole((data as { role?: unknown }).role);
  if (role === 'owner' || role === 'admin') return role;
  if (role === 'office') return 'rep';
  return null;
}
