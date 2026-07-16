// Email-specific GoHighLevel conversation helpers for Workstream 6's inbox
// reply flow. Kept separate from this file's sibling client.ts:
// sendConversationMessage() there sends by contactId only (no
// conversationId), which is fine for a fresh follow-up but not for replying
// INTO the exact conversation thread an inbound email arrived on -- and
// client.ts has no conversation search/read at all (Phase 0 only needed
// contact lookup). Both endpoints below are best-effort shapes, not verified
// against a live payload (same caveat as sendConversationMessage's own
// comment) -- scripts/ghl-probe.mjs has only ever probed contacts search, so
// a live check of these two is real follow-up work (see this workstream's
// PR body).
//
// Uses the newly-exported ghlFetch from client.ts directly rather than
// requireConfig() (kept private there) -- HIGHLEVEL_LOCATION_ID is read the
// same direct way client.ts's own getContactPageUrl() already does.

import { ghlFetch } from './client';

export type GhlInboundEmailConversation = {
  contactId: string;
  conversationId: string;
  sourceMessageId: string | null;
  fromAddress: string | null;
  fromName: string | null;
  subject: string | null;
  body: string | null;
  receivedAt: string | null;
};

type RawConversation = {
  id?: string;
  contactId?: string;
  lastMessageType?: string;
  contactName?: string;
  email?: string;
};

type RawMessage = {
  id?: string;
  type?: string;
  direction?: string;
  subject?: string;
  body?: string;
  dateAdded?: string;
};

// GET /conversations/search?locationId=...&limit=... -- one page, newest
// activity first (best-effort: HighLevel's own default sort), capped to
// bound the per-conversation messages fetch below to a "check inbox now"
// button click, not a background crawl.
async function searchConversations(limit: number): Promise<RawConversation[]> {
  const locationId = process.env.HIGHLEVEL_LOCATION_ID ?? '';
  const params = new URLSearchParams({ locationId, limit: String(limit) });
  const json = await ghlFetch<{ conversations?: RawConversation[] }>(`/conversations/search?${params}`);
  return json.conversations ?? [];
}

// GET /conversations/{id}/messages -- the message list for one conversation.
// Best-effort ordering assumption (oldest first, like most chat APIs); the
// scan below reverses and searches from the newest message backward.
async function getMessages(conversationId: string): Promise<RawMessage[]> {
  const json = await ghlFetch<{ messages?: { messages?: RawMessage[] } | RawMessage[] }>(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
  );
  const raw = json.messages;
  if (Array.isArray(raw)) return raw;
  return raw?.messages ?? [];
}

// Scans up to `conversationLimit` recent conversations and returns the
// latest inbound email message found in each -- the fallback path
// (POST /api/inbox/check) for whatever the live webhook missed. Best-effort:
// a single conversation's message fetch failing does not abort the whole
// scan, it just skips that conversation.
export async function searchRecentInboundEmails(conversationLimit = 20): Promise<GhlInboundEmailConversation[]> {
  const conversations = await searchConversations(conversationLimit);
  const results: GhlInboundEmailConversation[] = [];

  for (const convo of conversations) {
    if (!convo.id || !convo.contactId) continue;
    if (convo.lastMessageType && !convo.lastMessageType.toLowerCase().includes('email')) continue;

    let messages: RawMessage[];
    try {
      messages = await getMessages(convo.id);
    } catch (err) {
      console.error(`Could not load messages for GHL conversation ${convo.id}:`, err);
      continue;
    }

    const inboundEmail = [...messages]
      .reverse()
      .find(m => (m.type ?? '').toLowerCase().includes('email') && (m.direction ?? '').toLowerCase() !== 'outbound');
    if (!inboundEmail) continue;

    results.push({
      contactId: convo.contactId,
      conversationId: convo.id,
      sourceMessageId: inboundEmail.id ?? null,
      fromAddress: convo.email ?? null,
      fromName: convo.contactName ?? null,
      subject: inboundEmail.subject ?? null,
      body: inboundEmail.body ?? null,
      receivedAt: inboundEmail.dateAdded ?? null,
    });
  }

  return results;
}

export type SendEmailReplyInput = {
  contactId: string;
  conversationId?: string | null;
  subject: string;
  html: string;
};

// POST /conversations/messages, type Email -- same endpoint as client.ts's
// sendConversationMessage, with conversationId threaded through so the
// reply lands in the SAME thread the inbound email arrived on when we know
// its id, instead of letting HighLevel route to "some" conversation for
// this contact. Never call this from anywhere that has not already passed
// the GHL_SEND_ENABLED gate + the human click (see
// POST /api/inbox/[draftId]/send) -- this function itself does not gate
// anything, same contract as sendConversationMessage.
export async function sendEmailReply(input: SendEmailReplyInput): Promise<{ messageId: string | null }> {
  const locationId = process.env.HIGHLEVEL_LOCATION_ID ?? '';
  const body: Record<string, unknown> = {
    type: 'Email',
    contactId: input.contactId,
    locationId,
    subject: input.subject,
    html: input.html,
  };
  if (input.conversationId) body.conversationId = input.conversationId;

  const json = await ghlFetch<{ messageId?: string; conversationId?: string }>('/conversations/messages', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return { messageId: json.messageId ?? json.conversationId ?? null };
}
