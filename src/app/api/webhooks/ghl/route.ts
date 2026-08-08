// POST /api/webhooks/ghl — GoHighLevel webhook receiver. Exempt from the
// employee session in src/proxy.ts (a webhook has no user session); verified
// using HighLevel's X-GHL-Signature over the raw body. A constant-time legacy
// shared secret remains temporarily compatible with the private workflow URL.
// Always ack close to 200 once past the authentication check —
// GHL retries on a non-2xx, and an unrecognized event type is expected
// traffic (this app only cares about inbound calls/messages), not an error.
//
// On a recognized inbound call/message: look up a matching lead by GHL
// contact id (if one already exists) and log an events_log row that
// GET /api/inbound/recent polls for the dashboard screen-pop. The lead
// itself is auto-created lazily by that route, not here, so a webhook
// delivery that arrives before anyone looks at the dashboard doesn't orphan
// a lead nobody ever sees.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { mapGhlWebhookPayload } from '@/lib/leads/webhook';
import { authenticateGhlWebhook, buildGhlWebhookEventKey } from '@/lib/auth/ghlWebhook';

export async function POST(request: Request) {
  const rawBody = await request.text();
  const authentication = authenticateGhlWebhook(request, rawBody);
  if (authentication !== 'authorized') {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: authentication === 'unconfigured' ? 503 : 401 },
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const payload = parseJson(rawBody);
  const event = mapGhlWebhookPayload(payload);
  if (!event.recognized) {
    return NextResponse.json({ configured: true, received: true, logged: false });
  }

  const supabase = getSupabaseServerClient()!;

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
    source_event_key: buildGhlWebhookEventKey(rawBody),
    detail: { contactId: event.contactId, phone: event.phone, name: event.name, channel: event.channel, leadId, verticalSlug },
  });
  if (error) {
    if ((error as { code?: unknown }).code === '23505') {
      return NextResponse.json({
        configured: true,
        received: true,
        logged: false,
        duplicate: true,
      });
    }
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0004 first.' });
    }
    console.error('Log inbound webhook event failed:', error);
    return NextResponse.json({ configured: true, received: true, logged: false, error: 'Could not log the event.' }, { status: 500 });
  }

  return NextResponse.json({ configured: true, received: true, logged: true });
}

function parseJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}
