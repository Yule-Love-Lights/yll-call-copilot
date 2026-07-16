// GHL recording sync (Workstream 1, see docs/SALES-EXCELLENCE-PLAN.md
// section 4): lists recently completed call messages that carry a
// recording, and downloads one recording's audio bytes. Shares client.ts's
// authenticated fetch (ghlFetch, now exported) for the JSON endpoints; the
// audio download needs its own raw-bytes fetch since ghlFetch always
// json()s the response.
//
// UNVERIFIED against a live GHL payload -- flagged honestly, same
// convention as HighLevelOpportunity's date fields in ./types.ts. The
// Conversations API (GET /conversations/search, GET /conversations/
// {id}/messages) is documented and used here because it is the closest
// confirmed-real GHL endpoint pair to "list completed calls with
// recordings" for a Private Integration token, but the exact field names
// for a call message's duration/status have not been probed against a real
// payload (scripts/ghl-probe.mjs has no call-message probe yet). Before the
// nightly cron goes live, run a probe against a real conversation that has
// a completed call message and adjust the field mapping below if it
// doesn't match. The recording download endpoint shape (GET
// /conversations/messages/{messageId}/locations/{locationId}/recording) was
// given directly by the workstream brief, also unverified live.

import { ghlFetch } from './client';

const API_BASE = 'https://services.leadconnectorhq.com';
const API_VERSION_HEADER = '2021-07-28';

export class GhlRecordingError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'GhlRecordingError';
  }
}

function requireConfig(): { apiKey: string; locationId: string } {
  const apiKey = process.env.HIGHLEVEL_API_KEY;
  const locationId = process.env.HIGHLEVEL_LOCATION_ID;
  if (!apiKey || !locationId) {
    throw new GhlRecordingError('HighLevel not configured. Set HIGHLEVEL_API_KEY and HIGHLEVEL_LOCATION_ID.');
  }
  return { apiKey, locationId };
}

export type GhlCallRecordingMessage = {
  messageId: string;
  conversationId: string;
  contactId: string | null;
  // The GHL staff user this call is attributed to. Ground truth for
  // rep_email on the resulting transcript row -- unlike the RingCentral
  // export (repDetection.ts), a GHL call message already carries the real
  // owning user, so there is no name-frequency guessing to do here.
  userId: string | null;
  direction: 'inbound' | 'outbound' | null;
  dateAdded: string | null;
  durationSeconds: number | null;
};

type GhlConversationSummary = { id: string; contactId?: string; lastMessageDate?: string };

type GhlMessage = {
  id: string;
  type?: string;
  messageType?: string;
  contactId?: string;
  userId?: string;
  direction?: string;
  dateAdded?: string;
  meta?: { call?: { status?: string; duration?: number } };
  callDuration?: number;
  callStatus?: string;
};

const CONVERSATIONS_PAGE_LIMIT = 50;
const MESSAGES_PAGE_LIMIT = 50;
// Hard cap on conversations scanned per sync run -- a runaway pagination
// loop (e.g. a field-name mismatch means lastMessageDate never crosses
// `sinceIso`) must not turn a nightly cron into an unbounded crawl.
const MAX_CONVERSATIONS_SCANNED = 500;

// Exported for tests -- pure classification of one GHL message as a
// finished, recorded call. "completed" is GHL's documented terminal status
// for a finished call message; voicemail/no-answer/busy carry no useful
// recording.
export function isCompletedCallMessage(m: GhlMessage): boolean {
  const type = (m.messageType ?? m.type ?? '').toUpperCase();
  if (!type.includes('CALL')) return false;
  const status = (m.meta?.call?.status ?? m.callStatus ?? '').toLowerCase();
  return status === 'completed';
}

// Exported for tests -- pulls a call message's duration from whichever
// field shape the payload actually uses.
export function messageDuration(m: GhlMessage): number | null {
  const d = m.meta?.call?.duration ?? m.callDuration;
  return typeof d === 'number' ? d : null;
}

// Pages through conversations newest-first, then each conversation's
// messages, collecting completed call messages added since `sinceIso` (up
// to `limit`). Conversations are assumed sorted by last-message-date
// descending (the default the GHL Conversations API documents) so the scan
// can stop the moment one conversation's lastMessageDate falls before the
// sync window, instead of paging through the whole account every night.
export async function listRecentCallRecordings(sinceIso: string, limit = 100): Promise<GhlCallRecordingMessage[]> {
  const { locationId } = requireConfig();
  const since = new Date(sinceIso).getTime();
  const results: GhlCallRecordingMessage[] = [];
  let offset = 0;
  let scanned = 0;

  while (results.length < limit && scanned < MAX_CONVERSATIONS_SCANNED) {
    const params = new URLSearchParams({
      locationId,
      limit: String(CONVERSATIONS_PAGE_LIMIT),
      offset: String(offset),
      sort: 'desc',
      sortBy: 'last_message_date',
    });
    const page = await ghlFetch<{ conversations?: GhlConversationSummary[] }>(`/conversations/search?${params}`);
    const conversations = page.conversations ?? [];
    if (conversations.length === 0) break;

    for (const convo of conversations) {
      scanned++;
      if (convo.lastMessageDate && new Date(convo.lastMessageDate).getTime() < since) {
        // Newest-first order means every remaining conversation (this page
        // and later ones) is also older than the window -- stop the whole
        // scan here rather than paging further.
        return results;
      }

      const messagesPage = await ghlFetch<{ messages?: { messages?: GhlMessage[] } }>(
        `/conversations/${encodeURIComponent(convo.id)}/messages?limit=${MESSAGES_PAGE_LIMIT}`,
      ).catch(() => ({ messages: { messages: [] } }));
      const messages = messagesPage.messages?.messages ?? [];

      for (const m of messages) {
        if (!m.dateAdded || new Date(m.dateAdded).getTime() < since) continue;
        if (!isCompletedCallMessage(m)) continue;
        results.push({
          messageId: m.id,
          conversationId: convo.id,
          contactId: m.contactId ?? convo.contactId ?? null,
          userId: m.userId ?? null,
          direction: m.direction === 'inbound' || m.direction === 'outbound' ? m.direction : null,
          dateAdded: m.dateAdded,
          durationSeconds: messageDuration(m),
        });
        if (results.length >= limit) return results;
      }
    }

    offset += CONVERSATIONS_PAGE_LIMIT;
  }

  return results;
}

// Raw-bytes fetch -- ghlFetch always json()s its response, which would
// corrupt binary audio, so this hits the same base URL / auth / version
// header directly instead of going through it.
export async function downloadRecordingAudio(messageId: string): Promise<Buffer> {
  const { apiKey, locationId } = requireConfig();
  const res = await fetch(
    `${API_BASE}/conversations/messages/${encodeURIComponent(messageId)}/locations/${encodeURIComponent(locationId)}/recording`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: API_VERSION_HEADER,
        Accept: 'audio/*',
      },
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GhlRecordingError(`GHL recording download -> ${res.status}: ${body.slice(0, 300)}`, res.status);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ─── Rep identity ───────────────────────────────────────────────────────────
// Resolves a GHL staff user id (call_recordings.ghl_user_id, straight off
// the call message -- ground truth, not a guess) to that user's email, for
// the transcripts.rep_email column. This is deliberately NOT
// repDetection.ts's corpus-wide name-frequency approach: that algorithm
// exists because a RingCentral export carries no reliable per-file label for
// which speaker is the rep (see repDetection.ts's own module comment) --
// here GHL already tells us definitively which staff user owns the call, so
// there is nothing to infer. Best-effort: any failure degrades to null
// (pipeline.ts stores rep_email null rather than failing the whole
// recording over an identity lookup).
//
// Endpoint: GET /users/{userId} -- unverified against a live payload, same
// caveat as the rest of this file.
export async function getGhlUserEmail(userId: string): Promise<string | null> {
  try {
    const json = await ghlFetch<{ email?: string; user?: { email?: string } }>(`/users/${encodeURIComponent(userId)}`);
    return json.email ?? json.user?.email ?? null;
  } catch (err) {
    console.error(`GHL user lookup failed for ${userId}:`, err);
    return null;
  }
}
