// POST /api/leads/[id]/decide — body {action: 'claim' | 'dismiss'}. Claim
// sets status='claimed' and claimed_by to the signed-in rep's email; dismiss
// sets status='dismissed'. Same naming convention as
// POST /api/proposals/[id]/decide (a body flag rather than two routes).
// Only a still-queued lead can be decided — a claim/dismiss race against
// another rep, or against the lead already having been worked, is rejected
// rather than silently overwritten.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';
import type { LeadRow } from '@/lib/leads/types';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, decided: false, reason: 'Supabase not configured.' });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const action = body?.action;
  if (action !== 'claim' && action !== 'dismiss') {
    return NextResponse.json(
      { configured: true, decided: false, reason: 'action must be "claim" or "dismiss".' },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServerClient()!;
  const { data: leadData, error: leadError } = await supabase.from('leads').select('id, status').eq('id', id).maybeSingle();
  if (leadError) {
    if (isMissingTableError(leadError)) {
      return NextResponse.json({ configured: true, decided: false, reason: 'Run migration 0004 first.' });
    }
    console.error('Load lead for decide failed:', leadError);
    return NextResponse.json({ configured: true, decided: false, reason: 'Could not load the lead.' }, { status: 500 });
  }
  if (!leadData) {
    return NextResponse.json({ configured: true, decided: false, reason: 'Lead not found.' }, { status: 404 });
  }
  const lead = leadData as Pick<LeadRow, 'id' | 'status'>;

  if (lead.status !== 'queued') {
    return NextResponse.json(
      { configured: true, decided: false, reason: 'This lead is no longer queued.' },
      { status: 409 },
    );
  }

  const update =
    action === 'claim' ? { status: 'claimed', claimed_by: await getSessionEmail() } : { status: 'dismissed' };

  const { error: updateError } = await supabase.from('leads').update(update).eq('id', id);
  if (updateError) {
    console.error(`Lead ${action} failed:`, updateError);
    return NextResponse.json({ configured: true, decided: false, reason: 'Could not update the lead.' }, { status: 500 });
  }

  return NextResponse.json({ configured: true, decided: true, status: update.status });
}
