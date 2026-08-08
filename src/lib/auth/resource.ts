import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAuthServerClient, getSupabaseServerClient } from '@/lib/supabase';
import { resolveHubActor, type ActorResolution } from './actor';
import { hasCapability, type Capability, type HubActor } from './capabilities';

export async function resolveCurrentHubActor(): Promise<ActorResolution> {
  const authClient = await getSupabaseAuthServerClient();
  if (!authClient) return { status: 'unavailable' };

  const { data, error } = await authClient.auth.getUser();
  if (error) return { status: 'unavailable' };
  if (!data.user) {
    return { status: 'denied', reason: 'invalid_session_identity' };
  }
  return resolveHubActor(data.user);
}

export type OwnedResourceDecision = 'self' | 'team' | 'denied';

export function decideOwnedResourceAccess(
  actor: HubActor,
  ownerEmail: unknown,
  teamCapability: Capability = 'operations.admin',
): OwnedResourceDecision {
  if (typeof ownerEmail !== 'string' || !ownerEmail.trim()) return 'denied';
  if (ownerEmail.trim().toLowerCase() === actor.email) return 'self';
  return hasCapability(actor, teamCapability) ? 'team' : 'denied';
}

// A team-wide sensitive read/action is not allowed to proceed unless its audit
// record is durable. Do not include customer content or transcript text here.
export async function auditTeamResourceAccess(
  client: SupabaseClient,
  input: {
    actor: HubActor;
    action: string;
    resourceType: string;
    resourceId: string;
    ownerEmail: string;
  },
): Promise<boolean> {
  const { error } = await client.from('events_log').insert({
    kind: 'authorization_team_access',
    detail: {
      actingEmployeeId: input.actor.employeeId,
      actingAuthUserId: input.actor.authUserId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      ownerEmail: input.ownerEmail.toLowerCase(),
    },
  });
  return !error;
}

export async function auditSensitiveRouteAccess(input: {
  actor: HubActor;
  method: string;
  routeTemplate: string;
}): Promise<boolean> {
  const client = getSupabaseServerClient();
  if (!client) return false;
  const { error } = await client.from('events_log').insert({
    kind: 'authorization_sensitive_route_access',
    detail: {
      actingEmployeeId: input.actor.employeeId,
      actingAuthUserId: input.actor.authUserId,
      method: input.method,
      routeTemplate: input.routeTemplate,
    },
  });
  return !error;
}

export function actorResolutionStatus(resolution: ActorResolution): 401 | 403 | 503 | null {
  if (resolution.status === 'unavailable') return 503;
  if (resolution.status === 'denied') return 403;
  return null;
}

export type CallResourceAuthorization =
  | { status: 'authorized'; ownerEmail: string; access: 'self' | 'team' }
  | { status: 'denied' }
  | { status: 'missing' }
  | { status: 'unavailable' };

export async function authorizeCallResource(
  client: SupabaseClient,
  input: {
    actor: HubActor;
    callId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    teamCapability?: Capability | null;
  },
): Promise<CallResourceAuthorization> {
  const { data, error } = await client
    .from('calls')
    .select('rep_email')
    .eq('id', input.callId)
    .maybeSingle();
  if (error) return { status: 'unavailable' };
  if (!data) return { status: 'missing' };

  const ownerEmail = (data as { rep_email?: unknown }).rep_email;
  if (typeof ownerEmail !== 'string' || !ownerEmail.trim()) return { status: 'denied' };

  const self = ownerEmail.trim().toLowerCase() === input.actor.email;
  if (self) return { status: 'authorized', ownerEmail, access: 'self' };
  if (!input.teamCapability || !hasCapability(input.actor, input.teamCapability)) {
    return { status: 'denied' };
  }

  const audited = await auditTeamResourceAccess(client, {
    actor: input.actor,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    ownerEmail,
  });
  return audited
    ? { status: 'authorized', ownerEmail, access: 'team' }
    : { status: 'unavailable' };
}
