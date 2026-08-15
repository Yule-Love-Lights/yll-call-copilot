// Compatibility helper for handlers that still branch on the old three-value
// role. The root proxy has already authorized the immutable UUID-linked actor,
// and getSessionEmail supplies that actor's stored compatibility email. This
// secondary projection never reads app_users.

import type { SupabaseClient } from '@supabase/supabase-js';
import { parseOpsEmployeeRole } from './capabilities';

export type LegacyStaffRole = 'rep' | 'owner' | 'admin';

export async function resolveStaffRole(
  supabase: SupabaseClient,
  email: string | null,
): Promise<LegacyStaffRole> {
  if (!email) return 'rep';
  const { data, error } = await supabase
    .from('ops_employees')
    .select('role, active')
    .eq('compatibility_email', email.toLowerCase())
    .maybeSingle();
  if (error || !data || (data as { active?: unknown }).active !== true) return 'rep';
  const role = parseOpsEmployeeRole((data as { role?: unknown }).role);
  return role === 'owner' || role === 'admin' ? role : 'rep';
}
