// PATCH /api/inbox/[draftId] — body {subject?, body?}. Lets a rep tweak a
// draft reply before sending. Mirrors PUT /api/followups/[id]'s shape: only
// a 'draft' row can be edited -- once sent, failed, or dismissed, the record
// is history.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import type { EmailReplyDraftRow } from '@/lib/email/types';

export async function PATCH(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false });
  }

  const { draftId } = await params;
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

  const { data: existingData, error: existingError } = await supabase
    .from('email_reply_drafts')
    .select('id, status')
    .eq('id', draftId)
    .maybeSingle();
  if (existingError) {
    if (isMissingTableError(existingError)) {
      return NextResponse.json({ configured: true, saved: false, reason: 'Run migration 0012 first.' });
    }
    console.error('Load email reply draft for edit failed:', existingError);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not load the draft.' }, { status: 500 });
  }
  if (!existingData) {
    return NextResponse.json({ configured: true, saved: false, error: 'Draft not found.' }, { status: 404 });
  }
  const existing = existingData as Pick<EmailReplyDraftRow, 'id' | 'status'>;
  if (existing.status !== 'draft') {
    return NextResponse.json(
      { configured: true, saved: false, error: 'Only a draft reply can be edited.' },
      { status: 409 },
    );
  }

  const { error: updateError } = await supabase.from('email_reply_drafts').update(update).eq('id', draftId);
  if (updateError) {
    console.error('Update email reply draft failed:', updateError);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not save the draft.' }, { status: 500 });
  }

  return NextResponse.json({ configured: true, saved: true });
}
