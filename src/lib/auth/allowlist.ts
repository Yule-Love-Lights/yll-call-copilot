// Deprecated compatibility wrapper around the canonical actor resolver. New
// authorization code should consume resolveHubActor and explicit capabilities.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '../supabase';
import { resolveHubActor } from './actor';

export type AllowlistDecision = 'allowed' | 'denied' | 'unconfigured';

export async function checkAllowlist(
  authUserId: string | null | undefined,
  client: SupabaseClient | null = getSupabaseServerClient(),
): Promise<AllowlistDecision> {
  if (!client) return 'unconfigured';
  if (!authUserId) return 'denied';

  const resolution = await resolveHubActor({ id: authUserId }, client);
  if (resolution.status === 'unavailable') return 'unconfigured';
  return resolution.status === 'resolved' ? 'allowed' : 'denied';
}

export function shouldDenyAccess(decision: AllowlistDecision): boolean {
  return decision === 'denied' || decision === 'unconfigured';
}
