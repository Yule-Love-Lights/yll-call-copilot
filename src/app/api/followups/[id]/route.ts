// Edits only the signed-in employee's own draft. Owner/Admin team access is
// read-only and cannot impersonate the call owner.

import { NextResponse } from 'next/server';
import { resolveCurrentHubActor } from '@/lib/auth/resource';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false }, { status: 503 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const messageBody = typeof body?.body === 'string' ? body.body.trim() : '';
  const subject = typeof body?.subject === 'string' ? body.subject : null;
  if (!UUID_PATTERN.test(id) || !messageBody) {
    return NextResponse.json({ configured: true, saved: false, error: 'A valid follow-up and non-empty message are required.' }, { status: 400 });
  }
  const actorResolution = await resolveCurrentHubActor();
  if (actorResolution.status !== 'resolved') {
    return NextResponse.json(
      { configured: true, saved: false, error: 'Access denied.' },
      { status: actorResolution.status === 'unavailable' ? 503 : 403 },
    );
  }
  const supabase = getSupabaseServerClient()!;
  const { data, error } = await supabase.rpc('update_owned_followup_draft', {
    p_actor_employee_id: actorResolution.actor.employeeId,
    p_actor_email: actorResolution.actor.email,
    p_followup_id: id,
    p_subject: subject,
    p_body: messageBody,
  });
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, saved: false, migrated: false, reason: 'Run migration 0020 first.' });
    }
    console.error('Update follow-up draft failed:', error);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not save the follow-up.' }, { status: 500 });
  }
  const code = ((Array.isArray(data) ? data[0] : data) as { result_code?: string } | null)?.result_code;
  if (code === 'followup_missing') {
    return NextResponse.json({ configured: true, saved: false, error: 'Follow-up not found.' }, { status: 404 });
  }
  if (code === 'actor_inactive' || code === 'not_owned') {
    return NextResponse.json({ configured: true, saved: false, error: 'Access denied.' }, { status: 403 });
  }
  if (code === 'not_draft') {
    return NextResponse.json({ configured: true, saved: false, error: 'Only a draft follow-up can be edited.' }, { status: 409 });
  }
  if (code !== 'updated') {
    return NextResponse.json({ configured: true, saved: false, error: 'Could not save the follow-up.' }, { status: code === 'invalid_input' ? 400 : 500 });
  }
  return NextResponse.json({ configured: true, saved: true });
}
