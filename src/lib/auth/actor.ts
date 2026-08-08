import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '@/lib/supabase';
import {
  buildLegacyActor,
  parseAppUserRole,
  type HubActor,
} from './capabilities';

export interface AuthenticatedUserIdentity {
  readonly id?: unknown;
  readonly email?: unknown;
}

export type ActorResolution =
  | { readonly status: 'resolved'; readonly actor: HubActor }
  | {
      readonly status: 'denied';
      readonly reason:
        | 'invalid_session_identity'
        | 'not_staff'
        | 'invalid_employee_identity'
        | 'unknown_role'
        | 'manager_unprovisioned'
        | 'field_provisioning_blocked'
        | 'owner_admin_identity_not_approved';
    }
  | { readonly status: 'unavailable' };

interface AppUserRow {
  id?: unknown;
  role?: unknown;
}

// Resolves the one immutable Hub-local actor used by request authorization.
// app_users is still the bootstrap identity source; Phase 0's additive identity
// schema will replace its inferred memberships and null context projection.
export async function resolveHubActor(
  user: AuthenticatedUserIdentity,
  client: SupabaseClient | null = getSupabaseServerClient(),
): Promise<ActorResolution> {
  const authUserId = normalizedNonEmptyString(user.id);
  const email = normalizedEmail(user.email);
  if (!authUserId || !email) {
    return { status: 'denied', reason: 'invalid_session_identity' };
  }
  if (!client) return { status: 'unavailable' };

  const { data, error } = await client
    .from('app_users')
    .select('id, role')
    .eq('email', email)
    .maybeSingle();

  if (error) return { status: 'unavailable' };
  if (!data) return { status: 'denied', reason: 'not_staff' };

  const row = data as AppUserRow;
  const employeeId = normalizedNonEmptyString(row.id);
  if (!employeeId) {
    return { status: 'denied', reason: 'invalid_employee_identity' };
  }

  const role = parseAppUserRole(row.role);
  if (!role) return { status: 'denied', reason: 'unknown_role' };
  if (role === 'manager') {
    return { status: 'denied', reason: 'manager_unprovisioned' };
  }
  // Field accounts remain a hard release stop until OTP, immutable identity
  // linkage, canonical paid-context projection, RLS, and resource tests land.
  if (role === 'advertising' || role === 'installer') {
    return { status: 'denied', reason: 'field_provisioning_blocked' };
  }
  if ((role === 'owner' || role === 'admin') && !isApprovedOwnerAdmin(authUserId)) {
    return { status: 'denied', reason: 'owner_admin_identity_not_approved' };
  }

  const actor = buildLegacyActor({ authUserId, employeeId, email, appUserRole: role });
  if (!actor) return { status: 'denied', reason: 'manager_unprovisioned' };
  return { status: 'resolved', actor };
}

function isApprovedOwnerAdmin(authUserId: string): boolean {
  const approvedIds = (process.env.HUB_OWNER_ADMIN_AUTH_USER_IDS ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return (
    approvedIds.length === 2 &&
    new Set(approvedIds).size === 2 &&
    approvedIds.every(id => uuid.test(id)) &&
    approvedIds.includes(authUserId)
  );
}

function normalizedNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizedEmail(value: unknown): string | null {
  const normalized = normalizedNonEmptyString(value);
  if (!normalized || !normalized.includes('@')) return null;
  return normalized.toLowerCase();
}
