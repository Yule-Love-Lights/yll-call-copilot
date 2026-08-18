// Compatibility projection for routes that still attribute existing facts by
// email. The value is loaded from the immutable UUID-linked employee actor,
// not from Supabase auth metadata, so phone-only sessions work unchanged.

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveCurrentHubActor } from './resource';

export async function getSessionEmail(
  authClient?: SupabaseClient | null,
  identityClient?: SupabaseClient | null,
): Promise<string | null> {
  const resolution = await resolveCurrentHubActor(authClient, identityClient);
  return resolution.status === 'resolved' ? resolution.actor.email : null;
}
