// Pure mapper from a raw GoHighLevel webhook payload to the shape
// POST /api/webhooks/ghl needs to log an inbound event. Kept separate from
// the route (which does the secret check + Supabase write) so the mapping
// itself is unit-testable without any request plumbing — same split as
// transcripts/outcomes.ts's classifyStageName.
//
// GHL webhook payloads vary by event source and have not been verified
// against a live delivery, so this tolerates missing fields and reads from
// either a flat shape (contactId/phone/firstName at the top level) or a
// nested `contact` object, and treats `type`/`event` and `messageType`
// case-insensitively as substrings rather than exact enum values.

export type InboundChannel = 'call' | 'sms' | 'message' | 'unknown';

export type InboundEvent = {
  // False for anything that isn't an inbound call/SMS/message with an
  // identifiable contact — the route acks with 200 either way (so GHL
  // doesn't retry) but only writes an events_log row when true.
  recognized: boolean;
  channel: InboundChannel;
  contactId: string | null;
  phone: string | null;
  name: string | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function fullNameFrom(root: Record<string, unknown>, contact: Record<string, unknown>): string | null {
  const direct = asString(root.fullName) ?? asString(root.contactName) ?? asString(contact.name);
  if (direct) return direct;
  const first = asString(root.firstName) ?? asString(contact.firstName);
  const last = asString(root.lastName) ?? asString(contact.lastName);
  const joined = [first, last].filter(Boolean).join(' ').trim();
  return joined || null;
}

// Emails route through the same "InboundMessage" event type in GHL as SMS,
// but an inbound email popping a call-console card for every rep would be
// noisy and isn't a call — excluded on purpose, channel stays 'unknown'.
function classifyChannel(typeLower: string, messageTypeLower: string): InboundChannel {
  const combined = `${typeLower} ${messageTypeLower}`;
  if (combined.includes('email')) return 'unknown';
  if (combined.includes('call')) return 'call';
  if (combined.includes('sms')) return 'sms';
  if (typeLower.includes('message')) return 'message';
  return 'unknown';
}

export function mapGhlWebhookPayload(payload: unknown): InboundEvent {
  const root = asRecord(payload);
  const empty: InboundEvent = { recognized: false, channel: 'unknown', contactId: null, phone: null, name: null };
  if (!root) return empty;

  const contact = asRecord(root.contact) ?? {};
  const typeLower = (asString(root.type) ?? asString(root.event) ?? '').toLowerCase();
  const messageTypeLower = (asString(root.messageType) ?? asString(contact.messageType) ?? '').toLowerCase();

  const contactId = asString(root.contactId) ?? asString(root.contact_id) ?? asString(contact.id);
  const phone = asString(root.phone) ?? asString(contact.phone);
  const name = fullNameFrom(root, contact);
  const channel = classifyChannel(typeLower, messageTypeLower);

  const recognized = typeLower.includes('inbound') && channel !== 'unknown' && contactId !== null;

  return { recognized, channel, contactId, phone, name };
}
