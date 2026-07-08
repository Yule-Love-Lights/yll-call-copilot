// POST /api/webhooks/ghl?key=... — GoHighLevel webhook receiver. Exempt from
// the staff-session auth in src/proxy.ts (a webhook has no user session);
// authenticated instead by a shared secret query param checked here against
// GHL_WEBHOOK_SECRET. Always ack close to 200 once past the secret check —
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
    detail: { contactId: event.contactId, phone: event.phone, name: event.name, channel: event.channel, leadId, verticalSlug },
  });
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0004 first.' });
    }
    console.error('Log inbound webhook event failed:', error);
    return NextResponse.json({ configured: true, received: true, logged: false, error: 'Could not log the event.' }, { status: 500 });
  }

  return NextResponse.json({ configured: true, received: true, logged: true });
}
