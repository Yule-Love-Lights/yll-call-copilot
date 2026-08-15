// POST /api/leads/[id]/decide — body {action: 'claim' | 'dismiss'}. Claim
// sets status='claimed' and claimed_by to the signed-in rep's email; dismiss
// sets status='dismissed'. Same naming convention as
// POST /api/proposals/[id]/decide (a body flag rather than two routes).
// Only a still-queued lead can be decided — a claim/dismiss race against
// another rep, or against the lead already having been worked, is rejected
// rather than silently overwritten.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveCurrentHubActor } from '@/lib/auth/resource';
import { getContact, getOpportunitiesForContact, getStageNameMap, isHighLevelConfigured } from '@/lib/ghl/client';
import { isCallable } from '@/lib/leads/scoring';
import { isWithinCallingHours } from '@/lib/leads/callingHours';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, decided: false, reason: 'Supabase not configured.' });
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json(
      { configured: true, decided: false, reason: 'Invalid lead id.' },
      { status: 400 },
    );
  }
  const body = await request.json().catch(() => null);
  const action = body?.action;
  if (action !== 'claim' && action !== 'dismiss') {
    return NextResponse.json(
      { configured: true, decided: false, reason: 'action must be "claim" or "dismiss".' },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServerClient()!;
  const actorResolution = await resolveCurrentHubActor();
  if (actorResolution.status !== 'resolved') {
    return NextResponse.json(
      { configured: true, decided: false, reason: 'Access denied.' },
      { status: actorResolution.status === 'unavailable' ? 503 : 403 },
    );
  }
  const actor = actorResolution.actor;
  let verifiedContactId: string | null = null;
  let verifiedTimezone: string | null = null;
  let callPermissionVerified = false;
  if (action === 'claim') {
    if (!isHighLevelConfigured()) {
      return NextResponse.json(
        { configured: true, decided: false, reason: 'Current customer call permission is unavailable.' },
        { status: 503 },
      );
    }
    const { data: leadSnapshot, error: leadSnapshotError } = await supabase
      .from('leads')
      .select('ghl_contact_id')
      .eq('id', id)
      .maybeSingle();
    verifiedContactId = (leadSnapshot as { ghl_contact_id?: string | null } | null)?.ghl_contact_id ?? null;
    if (leadSnapshotError || !verifiedContactId) {
      return NextResponse.json(
        { configured: true, decided: false, reason: 'Current customer call permission is unavailable.' },
        { status: leadSnapshotError ? 503 : 409 },
      );
    }
    try {
      const [contact, opportunities, stageNames] = await Promise.all([
        getContact(verifiedContactId),
        getOpportunitiesForContact(verifiedContactId),
        getStageNameMap(),
      ]);
      const currentStages = opportunities
        .map(opportunity => opportunity.pipelineStageId ? stageNames.get(opportunity.pipelineStageId) : null)
        .filter((stage): stage is string => !!stage);
      callPermissionVerified = isCallable({
        dnd: contact.dnd,
        dndSettings: contact.dndSettings,
        tags: contact.tags ?? [],
        stageNames: currentStages,
      });
      verifiedTimezone = contact.timezone?.trim() || null;
      if (!isWithinCallingHours(verifiedTimezone, new Date())) {
        return NextResponse.json(
          { configured: true, decided: false, reason: 'This contact is currently outside calling hours.' },
          { status: 409 },
        );
      }
    } catch (caught) {
      console.error('Verify current call permission before claim failed:', caught);
      return NextResponse.json(
        { configured: true, decided: false, reason: 'Current customer call permission is unavailable.' },
        { status: 503 },
      );
    }
    if (!callPermissionVerified) {
      return NextResponse.json(
        { configured: true, decided: false, reason: 'This customer cannot be called.' },
        { status: 409 },
      );
    }
  }

  // The routine validates the actor, row-locks the lead, changes the queue
  // state, and writes the decision audit in one transaction. A route-level
  // read followed by an update cannot make those facts atomic.
  const { data, error } = await supabase.rpc('decide_queued_lead', {
    p_actor_employee_id: actor.employeeId,
    p_actor_auth_user_id: actor.authUserId,
    p_actor_email: actor.email,
    p_lead_id: id,
    p_action: action,
    p_verified_contact_id: verifiedContactId,
    p_call_permission_verified: callPermissionVerified,
    p_verified_timezone: verifiedTimezone,
  });
  if (error) {
    console.error(`Lead ${action} failed:`, error);
    return NextResponse.json({ configured: true, decided: false, reason: 'Could not update the lead.' }, { status: 500 });
  }

  const resultCode = (data as { result_code?: unknown }[] | null)?.[0]?.result_code;
  if (resultCode === 'not_queued') {
    return NextResponse.json(
      { configured: true, decided: false, reason: 'This lead is no longer queued.' },
      { status: 409 },
    );
  }
  if (resultCode === 'not_owned') {
    return NextResponse.json(
      { configured: true, decided: false, reason: 'This lead is not assigned to you.' },
      { status: 403 },
    );
  }
  if (resultCode === 'claim_not_authorized') {
    return NextResponse.json(
      { configured: true, decided: false, reason: 'This customer cannot be called.' },
      { status: 409 },
    );
  }
  if (resultCode === 'outside_calling_hours') {
    return NextResponse.json(
      { configured: true, decided: false, reason: 'This contact is currently outside calling hours.' },
      { status: 409 },
    );
  }
  if (resultCode === 'actor_inactive') {
    return NextResponse.json(
      { configured: true, decided: false, reason: 'Access denied.' },
      { status: 403 },
    );
  }
  if (resultCode === 'invalid_input') {
    return NextResponse.json(
      { configured: true, decided: false, reason: 'Invalid lead decision.' },
      { status: 400 },
    );
  }
  if (resultCode !== 'claimed' && resultCode !== 'dismissed') {
    return NextResponse.json(
      { configured: true, decided: false, reason: 'Could not update the lead.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ configured: true, decided: true, status: resultCode });
}
