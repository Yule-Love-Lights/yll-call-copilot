import type { SupabaseClient } from '@supabase/supabase-js';
import { hasCapability, type HubActor } from './capabilities';

export type LeadWorkRow = {
  id: string;
  status: 'queued' | 'claimed' | 'done' | 'dismissed';
  claimed_by: string | null;
  claimed_employee_id: string | null;
};

export type LeadDetailAuthorization =
  | {
      status: 'authorized';
      access: 'self' | 'team';
      canWork: boolean;
      canManageFollowups: boolean;
    }
  | { status: 'denied' }
  | { status: 'unavailable' };

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized && normalized.includes('@') ? normalized : null;
}

export function isLeadClaimedByActor(actor: HubActor, lead: LeadWorkRow): boolean {
  return lead.claimed_employee_id === actor.employeeId
    && normalizedEmail(lead.claimed_by) === actor.email;
}

// Work that changes customer or employee-attributed facts is deliberately
// stricter than Owner/Admin read access. A privileged viewer must claim a
// queued lead as themselves before working it, so another employee's metrics
// can never be changed through an override.
export function authorizeActiveClaimedLead(
  actor: HubActor,
  lead: LeadWorkRow,
): { status: 'authorized' } | { status: 'denied' } {
  return lead.status === 'claimed' && isLeadClaimedByActor(actor, lead)
    ? { status: 'authorized' }
    : { status: 'denied' };
}

// A rep may reopen only their own claimed/done lead. Owner/Admin may inspect a
// foreign or unowned lead only after a resource-specific audit is durable, and
// that inspection is always read-only.
export async function authorizeLeadDetailRead(
  client: SupabaseClient,
  input: { actor: HubActor; lead: LeadWorkRow },
): Promise<LeadDetailAuthorization> {
  const { actor, lead } = input;
  const self = isLeadClaimedByActor(actor, lead);

  if (self && (lead.status === 'claimed' || lead.status === 'done')) {
    return {
      status: 'authorized',
      access: 'self',
      canWork: lead.status === 'claimed',
      canManageFollowups: true,
    };
  }

  if (!hasCapability(actor, 'operations.admin')) return { status: 'denied' };

  const { error } = await client.from('events_log').insert({
    kind: 'authorization_lead_detail_override',
    detail: {
      actingEmployeeId: actor.employeeId,
      actingAuthUserId: actor.authUserId,
      action: 'lead_detail.read',
      resourceType: 'lead',
      resourceId: lead.id,
      ownerEmployeeId: lead.claimed_employee_id,
      ownerEmail: normalizedEmail(lead.claimed_by),
      leadStatus: lead.status,
    },
  });
  if (error) return { status: 'unavailable' };

  return {
    status: 'authorized',
    access: 'team',
    canWork: false,
    canManageFollowups: false,
  };
}
