// Resolves an app_users.role for the scoreboard's visibility check. Mirrors
// src/lib/auth/allowlist.ts's checkAllowlist: fail closed — a query error or
// no matching row resolves to null, which resolveBoardScope() treats as the
// most private outcome, never as "let them see everything."

import type { SupabaseClient } from '@supabase/supabase-js';
import { parseAppUserRole } from '@/lib/auth/capabilities';

export type ScoreboardRole = 'rep' | 'owner' | 'admin';

export async function resolveRepRole(
  email: string | null | undefined,
  client: SupabaseClient,
): Promise<ScoreboardRole | null> {
  if (!email) return null;
  const { data, error } = await client.from('app_users').select('role').eq('email', email.toLowerCase()).maybeSingle();
  if (error || !data) return null;
  const role = parseAppUserRole((data as { role?: unknown }).role);
  if (role === 'owner' || role === 'admin') return role;
  if (role === 'rep' || role === 'office') return 'rep';
  return null;
}
