// POST /api/live/start {leadId, mode} -- the rep clicked "Start coached
// call" on /call/[leadId]/live. Opens the calls row up front (no outcome
// yet -- that only happens once the rep tags one back on the normal
// console) and a live_sessions row anchored to it, mirroring the lookup +
// insert style of POST /api/calls.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';
import type { LeadRow } from '@/lib/leads/types';
import type { LiveSessionMode } from '@/lib/live/types';

const LIVE_SESSION_MODES: LiveSessionMode[] = ['twilio', 'simulator'];

function validateStartBody(body: unknown): { valid: true; leadId: string; mode: LiveSessionMode } | { valid: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { valid: false, error: 'Invalid request body.' };
  }
  const b = body as Record<string, unknown>;
  const leadId = typeof b.leadId === 'string' ? b.leadId.trim() : '';
  if (!leadId) return { valid: false, error: 'leadId is required.' };

  const mode = typeof b.mode === 'string' ? b.mode : '';
  if (!(LIVE_SESSION_MODES as string[]).includes(mode)) {
    return { valid: false, error: `mode must be one of: ${LIVE_SESSION_MODES.join(', ')}.` };
  }

  return { valid: true, leadId, mode: mode as LiveSessionMode };
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false, reason: 'Supabase not configured.' });
  }

  const body = await request.json().catch(() => null);
  const validation = validateStartBody(body);
  if (!validation.valid) {
    return NextResponse.json({ configured: true, saved: false, error: validation.error }, { status: 400 });
  }
  const { leadId, mode } = validation;

  const supabase = getSupabaseServerClient()!;

  const { data: leadData, error: leadError } = await supabase.from('leads').select('*').eq('id', leadId).maybeSingle();
  if (leadError) {
    if (isMissingTableError(leadError)) {
      return NextResponse.json({ configured: true, saved: false, migrated: false, reason: 'Run migration 0004 first.' });
    }
    console.error('Load lead for live session start failed:', leadError);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not load the lead.' }, { status: 500 });
  }
  if (!leadData) {
    return NextResponse.json({ configured: true, saved: false, error: 'Lead not found.' }, { status: 404 });
  }
  const lead = leadData as LeadRow;

  const rep_email = await getSessionEmail();
  const { data: callData, error: callError } = await supabase
    .from('calls')
    .insert({
      lead_id: lead.id,
      ghl_contact_id: lead.ghl_contact_id,
      rep_email,
      direction: 'outbound',
    })
    .select('id')
    .single();
  if (callError) {
    console.error('Insert call for live session failed:', callError);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not start the call.' }, { status: 500 });
  }
  const callId = (callData as { id: string }).id;

  const { data: sessionData, error: sessionError } = await supabase
    .from('live_sessions')
    .insert({ call_id: callId, mode })
    .select('id')
    .single();
  if (sessionError) {
    if (isMissingTableError(sessionError)) {
      return NextResponse.json({ configured: true, saved: false, migrated: false, reason: 'Run migration 0005 first.' });
    }
    console.error('Insert live session failed:', sessionError);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not start the live session.' }, { status: 500 });
  }
  const sessionId = (sessionData as { id: string }).id;

  return NextResponse.json({ configured: true, saved: true, sessionId, callId });
}
