// Pure mapper from a raw GoHighLevel webhook payload to the shape
// POST /api/webhooks/ghl needs to ingest an inbound customer email (see
// src/lib/email/ingest.ts). Deliberately separate from
// src/lib/leads/webhook.ts's mapGhlWebhookPayload: that mapper treats an
// inbound email as `channel: 'unknown'` on purpose (it feeds the
// call-console screen-pop, and a card popping for every email would be
// noisy) -- this is the email-drafting pipeline's own recognizer, unrelated
// to that decision.
//
// GHL webhook payloads vary by event source and have not been verified
// against a live delivery (same caveat as leads/webhook.ts), so this reads
// defensively from either a flat shape (contactId/subject/body at the top
// level) or nested `contact`/`message`/`email` objects.

export type InboundEmailEvent = {
  // False for anything that isn't an inbound email with an identifiable
  // contact and body -- the route acks with 200 either way (GHL retries on
  // a non-2xx) but only stores + drafts a row when true.
  recognized: boolean;
  sourceMessageId: string | null;
  contactId: string | null;
  conversationId: string | null;
  fromAddress: string | null;
  fromName: string | null;
  subject: string | null;
  body: string | null;
  receivedAt: string | null;
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

export function mapGhlInboundEmailPayload(payload: unknown): InboundEmailEvent {
  const empty: InboundEmailEvent = {
    recognized: false,
    sourceMessageId: null,
    contactId: null,
    conversationId: null,
    fromAddress: null,
    fromName: null,
    subject: null,
    body: null,
    receivedAt: null,
  };
  const root = asRecord(payload);
  if (!root) return empty;

  const contact = asRecord(root.contact) ?? {};
  const message = asRecord(root.message) ?? {};
  const email = asRecord(root.email) ?? {};

  const typeLower = (asString(root.type) ?? asString(root.event) ?? '').toLowerCase();
  const messageTypeLower = (asString(root.messageType) ?? asString(message.type) ?? '').toLowerCase();
  const directionLower = (asString(root.direction) ?? asString(message.direction) ?? '').toLowerCase();

  const isEmail = messageTypeLower.includes('email') || typeLower.includes('email');
  const isOutbound = directionLower.includes('outbound') || typeLower.includes('outbound');

  const contactId = asString(root.contactId) ?? asString(root.contact_id) ?? asString(contact.id);
  const conversationId = asString(root.conversationId) ?? asString(root.conversation_id);
  const sourceMessageId = asString(root.messageId) ?? asString(root.emailMessageId) ?? asString(message.id) ?? asString(root.id);
  const subject = asString(root.subject) ?? asString(message.subject) ?? asString(email.subject);
  const body = asString(root.body) ?? asString(message.body) ?? asString(email.body);
  const fromAddress = asString(root.from) ?? asString(email.from) ?? asString(contact.email);
  const fromName = fullNameFrom(root, contact);
  const receivedAt = asString(root.dateAdded) ?? asString(message.dateAdded);

  const recognized = isEmail && !isOutbound && contactId !== null && body !== null;

  return { recognized, sourceMessageId, contactId, conversationId, fromAddress, fromName, subject, body, receivedAt };
}
