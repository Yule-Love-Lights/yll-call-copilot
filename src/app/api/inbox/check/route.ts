// POST /api/inbox/check — staff-triggered pull (the UI's "Check inbox now"
// button). Two jobs, both best-effort:
//   1. Pull recent inbound-email conversations from GoHighLevel and ingest
//      any the live webhook (POST /api/webhooks/ghl) missed -- a workflow
//      not yet configured to fire it, a dropped delivery, etc. Idempotent on
//      source_message_id (src/lib/email/ingest.ts), so re-scanning the same
//      conversation twice is safe. Gmail is the same shape but currently a
//      no-op stub (src/lib/gmail.ts's isGmailConfigured() is false until
//      real OAuth creds exist -- see this workstream's PR body).
//   2. Retry drafting for any inbound email already stored but stuck at
//      status 'new' -- a prior Claude call failed after the row was safely
//      inserted (see ingestInboundEmail's best-effort catch), so this sweep
//      is what actually recovers it instead of leaving it stuck forever.
// No user input in the body -- staff session auth is proxy.ts's default
// (this path is not in its PUBLIC_PATHS list).

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { isHighLevelConfigured } from '@/lib/ghl/client';
import { searchRecentInboundEmails } from '@/lib/ghl/email';
import { fetchRecentInboundEmails, isGmailConfigured } from '@/lib/gmail';
import { draftForInboundEmail, ingestInboundEmail } from '@/lib/email/ingest';
import type { InboundEmailRow } from '@/lib/email/types';

// Caps how many conversations/messages one click scans -- this is a
// human-triggered button, not a background crawl, same philosophy as
// src/lib/ghl/client.ts's listContacts() page cap.
const CONVERSATION_SCAN_LIMIT = 20;
const RETRY_SWEEP_LIMIT = 20;

export async function POST() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false });
  }
  const supabase = getSupabaseServerClient()!;

  let pulled = 0;
  let ingested = 0;
  const errors: string[] = [];

  if (isHighLevelConfigured()) {
    try {
      const conversations = await searchRecentInboundEmails(CONVERSATION_SCAN_LIMIT);
      for (const convo of conversations) {
        if (!convo.body) continue;
        pulled++;
        const result = await ingestInboundEmail(supabase, {
          source: 'ghl',
          sourceMessageId: convo.sourceMessageId,
          ghlContactId: convo.contactId,
          ghlConversationId: convo.conversationId,
          fromAddress: convo.fromAddress,
          fromName: convo.fromName,
          subject: convo.subject,
          body: convo.body,
          receivedAt: convo.receivedAt,
        });
        if (!result.ok) {
          if (result.missingTable) {
            return NextResponse.json({ configured: true, migrated: false, reason: result.error });
          }
          errors.push(result.error);
        } else if (result.inserted) {
          ingested++;
        }
      }
    } catch (err) {
      console.error('Pull GHL conversations for inbox check failed:', err);
      errors.push('Could not reach GoHighLevel conversations.');
    }
  }

  if (isGmailConfigured()) {
    try {
      const gmailMessages = await fetchRecentInboundEmails();
      for (const msg of gmailMessages) {
        pulled++;
        const result = await ingestInboundEmail(supabase, {
          source: 'gmail',
          sourceMessageId: msg.sourceMessageId,
          fromAddress: msg.fromAddress,
          fromName: msg.fromName,
          subject: msg.subject,
          body: msg.body,
          receivedAt: msg.receivedAt,
        });
        if (!result.ok) errors.push(result.error);
        else if (result.inserted) ingested++;
      }
    } catch (err) {
      console.error('Pull Gmail messages for inbox check failed:', err);
      errors.push('Could not reach Gmail.');
    }
  }

  let redrafted = 0;
  const { data: stuckData, error: stuckError } = await supabase
    .from('inbound_emails')
    .select('id, subject, body, from_name')
    .eq('status', 'new')
    .order('created_at', { ascending: true })
    .limit(RETRY_SWEEP_LIMIT);
  if (stuckError) {
    if (isMissingTableError(stuckError)) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0012 first.' });
    }
    console.error('Load stuck inbound emails for retry sweep failed:', stuckError);
    errors.push('Could not load previously-failed drafts to retry.');
  } else {
    for (const row of (stuckData ?? []) as Pick<InboundEmailRow, 'id' | 'subject' | 'body' | 'from_name'>[]) {
      const result = await draftForInboundEmail(supabase, row);
      if (result.ok) redrafted++;
    }
  }

  return NextResponse.json({ configured: true, pulled, ingested, redrafted, errors });
}
