// POST /api/second-mile/[id]/decide — body {action: 'done' | 'skip'}. Marks
// a checklist-style touch worked (cookies_ornament, personal_touch) or a
// sendable touch handled some other way (a phone call instead of a text,
// say). Only a still-pending touch can be decided — the compare-and-swap
// update below rejects a second click the same way
// POST /api/leads/[id]/decide and POST /api/followups/[id]/send do.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';
import type { SecondMileTouchRow } from '@/lib/secondMile/types';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, decided: false });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const action = body?.action;
  if (action !== 'done' && action !== 'skip') {
    return NextResponse.json({ configured: true, decided: false, reason: 'action must be "done" or "skip".' }, { status: 400 });
  }

  const supabase = getSupabaseServerClient()!;
  const { data: existingData, error: existingError } = await supabase
    .from('second_mile_touches')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (existingError) {
    if (isMissingTableError(existingError)) {
      return NextResponse.json({ configured: true, decided: false, reason: 'Run migration 0013 first.' });
    }
    console.error('Load second-mile touch for decide failed:', existingError);
    return NextResponse.json({ configured: true, decided: false, reason: 'Could not load this touch.' }, { status: 500 });
  }
  if (!existingData) {
    return NextResponse.json({ configured: true, decided: false, reason: 'Touch not found.' }, { status: 404 });
  }
  const existing = existingData as Pick<SecondMileTouchRow, 'id' | 'status'>;
  if (existing.status !== 'pending') {
    return NextResponse.json({ configured: true, decided: false, reason: 'This touch is no longer pending.' }, { status: 409 });
  }

  const status = action === 'done' ? 'done' : 'skipped';
  const doneBy = await getSessionEmail();

  const { data: updatedRows, error: updateError } = await supabase
    .from('second_mile_touches')
    .update({ status, done_at: new Date().toISOString(), done_by: doneBy })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');
  if (updateError) {
    console.error(`Second-mile touch ${action} failed:`, updateError);
    return NextResponse.json({ configured: true, decided: false, reason: 'Could not update this touch.' }, { status: 500 });
  }
  if (!updatedRows || updatedRows.length === 0) {
    return NextResponse.json({ configured: true, decided: false, reason: 'This touch is no longer pending.' }, { status: 409 });
  }

  return NextResponse.json({ configured: true, decided: true, status });
}
