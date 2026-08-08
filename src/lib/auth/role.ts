// Compatibility helper for existing handlers while the proxy enforces the
// centralized capability policy. Only the closed legacy admin values may
// survive this boundary; field, Manager, unknown, and failed lookups all
// degrade to the least-privileged Office role.

import type { SupabaseClient } from '@supabase/supabase-js';
import { parseAppUserRole } from './capabilities';

export type LegacyStaffRole = 'rep' | 'owner' | 'admin';

export async function resolveStaffRole(
  supabase: SupabaseClient,
  email: string | null,
): Promise<LegacyStaffRole> {
  if (!email) return 'rep';
  const { data, error } = await supabase
    .from('app_users')
    .select('role')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  if (error || !data) return 'rep';
  const role = parseAppUserRole((data as { role?: unknown }).role);
  return role === 'owner' || role === 'admin' ? role : 'rep';
}
