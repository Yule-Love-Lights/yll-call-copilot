// GET /api/inbox — everything /inbox needs in one request: recent inbound
// emails newest-first, each with its current (most recently generated)
// reply draft if one exists. "Current" = the latest email_reply_drafts row
// for that inbound email -- a redraft supersedes the prior one (marks it
// 'dismissed' and inserts a fresh row, see
// POST /api/inbox/[draftId]/redraft), so taking the newest by created_at
// always shows the live one without a separate "is this superseded" filter.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import type { EmailReplyDraftRow, InboundEmailRow } from '@/lib/email/types';

// A human scanning the inbox, not an unbounded export -- same "one page is
// enough for a UI list" philosophy as the queue/leads endpoints.
const LIST_LIMIT = 100;

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false });
  }
  const supabase = getSupabaseServerClient()!;

  const { data: emailsData, error: emailsError } = await supabase
    .from('inbound_emails')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT);
  if (emailsError) {
    if (isMissingTableError(emailsError)) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0012 first.' });
    }
    console.error('Load inbound emails failed:', emailsError);
    return NextResponse.json({ configured: true, error: 'Could not load the inbox.' }, { status: 500 });
  }
  const emails = (emailsData ?? []) as InboundEmailRow[];

  const draftsByEmailId = new Map<string, EmailReplyDraftRow>();
  if (emails.length > 0) {
    const { data: draftsData } = await supabase
      .from('email_reply_drafts')
      .select('*')
      .in('inbound_email_id', emails.map(e => e.id))
      .order('created_at', { ascending: false });
    for (const row of (draftsData ?? []) as EmailReplyDraftRow[]) {
      if (!draftsByEmailId.has(row.inbound_email_id)) draftsByEmailId.set(row.inbound_email_id, row);
    }
  }

  return NextResponse.json({
    configured: true,
    // Lets the inbox disable Send buttons proactively (with a tooltip)
    // instead of only discovering the gate is closed after a failed POST --
    // same convention as GET /api/leads/[id]'s sendEnabled.
    sendEnabled: process.env.GHL_SEND_ENABLED === 'true',
    emails: emails.map(e => {
      const d = draftsByEmailId.get(e.id) ?? null;
      return {
        id: e.id,
        source: e.source,
        fromAddress: e.from_address,
        fromName: e.from_name,
        subject: e.subject,
        body: e.body,
        receivedAt: e.received_at,
        intent: e.intent,
        status: e.status,
        createdAt: e.created_at,
        draft: d
          ? {
              id: d.id,
              subject: d.subject,
              body: d.body,
              intent: d.intent,
              guaranteeUsed: d.guarantee_used,
              status: d.status,
              createdAt: d.created_at,
              sentAt: d.sent_at,
            }
          : null,
      };
    }),
  });
}
