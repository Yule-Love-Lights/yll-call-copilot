// POST /api/webhooks/ghl?key=... — GoHighLevel webhook receiver. Exempt from
// the staff-session auth in src/proxy.ts (a webhook has no user session);
// authenticated instead by a shared secret query param checked here against
// GHL_WEBHOOK_SECRET. Always ack close to 200 once past the secret check —
// GHL retries on a non-2xx, and an unrecognized event type is expected
// traffic (this app only cares about inbound calls/messages/emails), not an
// error.
//
// On a recognized inbound call/message: look up a matching lead by GHL
// contact id (if one already exists) and log an events_log row that
// GET /api/inbound/recent polls for the dashboard screen-pop. The lead
// itself is auto-created lazily by that route, not here, so a webhook
// delivery that arrives before anyone looks at the dashboard doesn't orphan
// a lead nobody ever sees.
//
// On a recognized inbound EMAIL (Workstream 6): store it and instantly
// draft a reply via src/lib/email/ingest.ts. Separate recognizer
// (src/lib/email/webhook.ts) from the call/SMS one above on purpose --
// mapGhlWebhookPayload treats email as `channel: 'unknown'` deliberately (it
// would otherwise pop a call-console card for every inbound email). Checked
// independently of the call/message branch so an event that is neither (or
// both, if GHL ever double-fires) is handled correctly either way; ingest
// failures are swallowed the same "always ack 200" way -- a missing
// migration or a Supabase hiccup here must never make GHL retry-storm this
// endpoint.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { mapGhlWebhookPayload } from '@/lib/leads/webhook';
import { mapGhlInboundEmailPayload } from '@/lib/email/webhook';
import { ingestInboundEmail } from '@/lib/email/ingest';

export async function POST(request: Request) {
  const key = new URL(request.url).searchParams.get('key');
  const expected = process.env.GHL_WEBHOOK_SECRET;
  if (!expected || key !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const payload = await request.json().catch(() => null);
  const supabase = getSupabaseServerClient()!;

  const emailEvent = mapGhlInboundEmailPayload(payload);
  let emailIngest: { attempted: boolean; drafted?: boolean } = { attempted: false };
  if (emailEvent.recognized && emailEvent.body) {
    try {
      const result = await ingestInboundEmail(supabase, {
        source: 'ghl',
        sourceMessageId: emailEvent.sourceMessageId,
        ghlContactId: emailEvent.contactId,
        ghlConversationId: emailEvent.conversationId,
        fromAddress: emailEvent.fromAddress,
        fromName: emailEvent.fromName,
        subject: emailEvent.subject,
        body: emailEvent.body,
        receivedAt: emailEvent.receivedAt,
      });
      emailIngest = { attempted: true, drafted: result.ok && result.inserted ? result.drafted : false };
    } catch (err) {
      // Never let an email-ingest failure break the webhook ack (see the
      // file-header comment) -- the call/message branch below still runs.
      console.error('Ingest inbound email from webhook failed:', err);
      emailIngest = { attempted: true, drafted: false };
    }
  }

  const event = mapGhlWebhookPayload(payload);
  if (!event.recognized) {
    return NextResponse.json({ configured: true, received: true, logged: false, email: emailIngest });
  }

  let leadId: string | null = null;
  let verticalSlug: string | null = null;
  if (event.contactId) {
    const { data: leadData } = await supabase
      .from('leads')
      .select('id, vertical_slug')
      .eq('ghl_contact_id', event.contactId)
      .maybeSingle();
    if (leadData) {
      const lead = leadData as { id: string; vertical_slug: string | null };
      leadId = lead.id;
      verticalSlug = lead.vertical_slug;
    }
  }

  const { error } = await supabase.from('events_log').insert({
    kind: 'inbound_call',
    detail: { contactId: event.contactId, phone: event.phone, name: event.name, channel: event.channel, leadId, verticalSlug },
  });
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0004 first.', email: emailIngest });
    }
    console.error('Log inbound webhook event failed:', error);
    return NextResponse.json(
      { configured: true, received: true, logged: false, error: 'Could not log the event.', email: emailIngest },
      { status: 500 },
    );
  }

  return NextResponse.json({ configured: true, received: true, logged: true, email: emailIngest });
}
