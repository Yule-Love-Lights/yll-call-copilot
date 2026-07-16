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
//
// When GHL omits every id field we'd otherwise use as source_message_id, a
// null id would defeat src/lib/email/ingest.ts's dedup (Postgres unique
// treats every NULL as distinct, and the existence check there skips null
// ids entirely) -- a redelivered webhook (e.g. GHL timing out waiting on our
// synchronous Claude drafting call) would then insert and draft the same
// email twice. So this derives a deterministic id from the contact + content
// instead of leaving it null: the same contact sending the same
// subject/body always produces the same id, so a retry of the identical
// payload is deduped the same way a real message id would be.

import { createHash } from 'node:crypto';

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

// Deterministic stand-in for a GHL message id when the payload has none --
// same contact + same subject/body always hashes to the same id, so a
// redelivery of the identical email is still deduped by
// src/lib/email/ingest.ts's existing source_message_id unique + existence
// check (see the file-header comment).
function deriveMessageId(contactId: string, subject: string | null, body: string): string {
  const hash = createHash('sha256').update(`${subject ?? ''}\n${body}`).digest('hex').slice(0, 24);
  return `derived:${contactId}:${hash}`;
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
  let sourceMessageId = asString(root.messageId) ?? asString(root.emailMessageId) ?? asString(message.id) ?? asString(root.id);
  const subject = asString(root.subject) ?? asString(message.subject) ?? asString(email.subject);
  const body = asString(root.body) ?? asString(message.body) ?? asString(email.body);
  const fromAddress = asString(root.from) ?? asString(email.from) ?? asString(contact.email);
  const fromName = fullNameFrom(root, contact);
  const receivedAt = asString(root.dateAdded) ?? asString(message.dateAdded);

  const recognized = isEmail && !isOutbound && contactId !== null && body !== null;

  // GHL didn't give us any message id -- derive one so a webhook retry of
  // the same email doesn't defeat ingest.ts's dedup (see file header).
  if (!sourceMessageId && recognized && contactId !== null && body !== null) {
    sourceMessageId = deriveMessageId(contactId, subject, body);
  }

  return { recognized, sourceMessageId, contactId, conversationId, fromAddress, fromName, subject, body, receivedAt };
}
