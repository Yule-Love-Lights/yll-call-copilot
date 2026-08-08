// PUT /api/followups/[id] — body {subject?, body?}. Lets a rep edit a draft
// before sending. Only a 'draft' row can be edited — once sent or failed,
// the record is history.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { authorizeCallResource, resolveCurrentHubActor } from '@/lib/auth/resource';
import type { FollowupRow } from '@/lib/leads/types';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false });
  }

  const { id } = await params;
  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') {
    return NextResponse.json({ configured: true, saved: false, error: 'Invalid request body.' }, { status: 400 });
  }
  const body = rawBody as Record<string, unknown>;

  const update: Record<string, string> = {};
  if (typeof body.subject === 'string') update.subject = body.subject;
  if (typeof body.body === 'string') update.body = body.body;
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ configured: true, saved: false, error: 'No updatable fields provided.' }, { status: 400 });
  }

  const supabase = getSupabaseServerClient()!;
  const actorResolution = await resolveCurrentHubActor();
  if (actorResolution.status !== 'resolved') {
    return NextResponse.json(
      { configured: true, saved: false, error: 'Access denied.' },
      { status: actorResolution.status === 'unavailable' ? 503 : 403 },
    );
  }

  const { data: existingData, error: existingError } = await supabase
    .from('followups')
    .select('id, call_id, status')
    .eq('id', id)
    .maybeSingle();
  if (existingError) {
    if (isMissingTableError(existingError)) {
      return NextResponse.json({ configured: true, saved: false, reason: 'Run migration 0004 first.' });
    }
    console.error('Load followup for edit failed:', existingError);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not load the follow-up.' }, { status: 500 });
  }
  if (!existingData) {
    return NextResponse.json({ configured: true, saved: false, error: 'Follow-up not found.' }, { status: 404 });
  }
  const existing = existingData as Pick<FollowupRow, 'id' | 'call_id' | 'status'>;
  if (!existing.call_id) {
    return NextResponse.json(
      { configured: true, saved: false, error: 'Access denied.' },
      { status: 403 },
    );
  }
  const authorization = await authorizeCallResource(supabase, {
    actor: actorResolution.actor,
    callId: existing.call_id,
    action: 'followup.edit',
    resourceType: 'followup',
    resourceId: id,
    teamCapability: 'operations.admin',
  });
  if (authorization.status !== 'authorized') {
    const status = authorization.status === 'unavailable' ? 503
      : authorization.status === 'missing' ? 404 : 403;
    return NextResponse.json(
      { configured: true, saved: false, error: 'Access denied.' },
      { status },
    );
  }
  if (existing.status !== 'draft') {
    return NextResponse.json(
      { configured: true, saved: false, error: 'Only a draft follow-up can be edited.' },
      { status: 409 },
    );
  }

  const { data: updatedRows, error: updateError } = await supabase
    .from('followups')
    .update(update)
    .eq('id', id)
    .eq('call_id', existing.call_id)
    .eq('status', 'draft')
    .select('id');
  if (updateError) {
    console.error('Update followup failed:', updateError);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not save the follow-up.' }, { status: 500 });
  }
  if (!updatedRows || updatedRows.length !== 1) {
    return NextResponse.json(
      { configured: true, saved: false, error: 'Only a draft follow-up can be edited.' },
      { status: 409 },
    );
  }

  return NextResponse.json({ configured: true, saved: true });
}
