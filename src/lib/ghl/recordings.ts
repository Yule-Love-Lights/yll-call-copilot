// GHL recording sync (Workstream 1, see docs/SALES-EXCELLENCE-PLAN.md
// section 4): lists recently completed call messages that carry a
// recording, and downloads one recording's audio bytes. Shares client.ts's
// authenticated fetch (ghlFetch, now exported) for the JSON endpoints; the
// audio download needs its own raw-bytes fetch since ghlFetch always
// json()s the response.
//
// The listing path and field mapping are pinned to HighLevel's official
// 2021-07-28 generated OpenAPI schema cited beside the export implementation
// below. They have not yet been probed against this location's live payload.
// Before the nightly cron goes live, run a read-only probe against a real
// completed call. The recording download endpoint shape (GET
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

type GhlMessage = {
  id: string;
  type?: string;
  messageType?: string;
  conversationId?: string;
  contactId?: string;
  userId?: string;
  direction?: string;
  dateAdded?: string;
  meta?: {
    call?: { status?: string; duration?: number };
    callStatus?: string;
    callDuration?: string | number;
  };
  callDuration?: number;
  callStatus?: string;
};

// HighLevel's official location-wide export is cursor-paginated and accepts up
// to 1,000 messages per request. This replaces the old N+1 conversation scan,
// which both lost calls after the first 50 messages in a conversation and
// could exceed HighLevel's 100 requests / 10 seconds burst limit.
const EXPORT_PAGE_LIMIT = 1000;
const MAX_EXPORT_PAGES = 20;

// Exported for tests -- pure classification of one GHL message as a
// finished, recorded call. "completed" is GHL's documented terminal status
// for a finished call message; voicemail/no-answer/busy carry no useful
// recording.
export function isCompletedCallMessage(m: GhlMessage): boolean {
  const type = (m.messageType ?? m.type ?? '').toUpperCase();
  if (!type.includes('CALL')) return false;
  const status = (m.meta?.callStatus ?? m.meta?.call?.status ?? m.callStatus ?? '').toLowerCase();
  return status === 'completed';
}

// Exported for tests -- pulls a call message's duration from whichever
// field shape the payload actually uses.
export function messageDuration(m: GhlMessage): number | null {
  const d = m.meta?.callDuration ?? m.meta?.call?.duration ?? m.callDuration;
  const parsed = typeof d === 'string' ? Number(d) : d;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
}

// HighLevel documents /conversations/messages/export for the pinned
// 2021-07-28 API version with locationId, channel=Call, start/end dates,
// ascending sort, and a short-lived nextCursor. Reproducible primary schema:
// https://marketplace.gohighlevel.com/docs/2021-07-28/ghl/conversations/export-messages-by-location
// generated OpenAPI asset https://marketplace.gohighlevel.com/docs/assets/js/fafdaa05.8964fc18.js,
// module 664011. We consume the provider cursor only inside one invocation,
// then expose a durable time continuation after proving the whole boundary
// timestamp was scanned.
export type RecentCallRecordingsStopReason = 'window_exhausted' | 'result_limit' | 'provider_page_cap';

/**
 * `nextSince` is present only when every call through that exclusive instant
 * was returned. The caller may persist it and continue draining the same
 * window. A provider-page-cap result advances only through a timestamp group
 * that a later provider message proved complete.
 */
export type RecentCallRecordingsPage = {
  messages: GhlCallRecordingMessage[];
  truncated: boolean;
  stopReason: RecentCallRecordingsStopReason;
  nextSince: string | null;
};

export async function listRecentCallRecordings(
  sinceIso: string,
  limit = 100,
  untilIso = new Date().toISOString(),
): Promise<RecentCallRecordingsPage> {
  const { locationId } = requireConfig();
  const since = new Date(sinceIso).getTime();
  const until = new Date(untilIso).getTime();
  if (!Number.isFinite(since) || !Number.isFinite(until) || until < since) {
    throw new GhlRecordingError('Invalid recording export window.');
  }

  if (!Number.isFinite(limit)) throw new GhlRecordingError('Invalid recording export limit.');
  const safeLimit = Math.max(1, Math.floor(limit));
  const results: GhlCallRecordingMessage[] = [];
  const seenProviderCursors = new Set<string>();
  let providerCursor: string | null = null;
  let lastSeenTime: number | null = null;
  let safeThroughTime: number | null = null;

  for (let pageNumber = 0; pageNumber < MAX_EXPORT_PAGES; pageNumber++) {
    const params = new URLSearchParams({
      locationId,
      channel: 'Call',
      limit: String(EXPORT_PAGE_LIMIT),
      sortBy: 'createdAt',
      sortOrder: 'asc',
      startDate: new Date(since).toISOString(),
      endDate: new Date(until).toISOString(),
    });
    if (providerCursor) params.set('cursor', providerCursor);

    const page = await ghlFetch<{ messages?: GhlMessage[]; nextCursor?: string | null }>(
      `/conversations/messages/export?${params}`,
    );
    const messages = page.messages ?? [];

    for (const m of messages) {
      const addedAt = m.dateAdded ? new Date(m.dateAdded).getTime() : Number.NaN;
      if (!Number.isFinite(addedAt)) {
        throw new GhlRecordingError('HighLevel export returned a message without a valid dateAdded.');
      }
      if (lastSeenTime !== null && addedAt < lastSeenTime) {
        throw new GhlRecordingError('HighLevel export violated the requested ascending date order.');
      }
      if (lastSeenTime !== null && addedAt > lastSeenTime) safeThroughTime = lastSeenTime;
      lastSeenTime = addedAt;

      if (addedAt < since || addedAt > until || !isCompletedCallMessage(m)) continue;
      if (!m.id || !m.conversationId) {
        throw new GhlRecordingError('HighLevel export returned a completed call without its required ids.');
      }
      results.push({
        messageId: m.id,
        conversationId: m.conversationId,
        contactId: m.contactId ?? null,
        userId: m.userId ?? null,
        direction: m.direction === 'inbound' || m.direction === 'outbound' ? m.direction : null,
        dateAdded: new Date(addedAt).toISOString(),
        durationSeconds: messageDuration(m),
      });
    }

    const ordered = results.sort((a, b) => {
      const byDate = new Date(a.dateAdded!).getTime() - new Date(b.dateAdded!).getTime();
      return byDate || a.messageId.localeCompare(b.messageId);
    });
    if (ordered.length > safeLimit) {
      const boundaryTime = new Date(ordered[safeLimit - 1].dateAdded!).getTime();
      // Seeing a later provider message, or exhausting the export, proves no
      // call sharing this boundary timestamp remains on an unseen page.
      if (lastSeenTime !== null && (lastSeenTime > boundaryTime || !page.nextCursor)) {
        const boundaryMessages = ordered.filter(message => new Date(message.dateAdded!).getTime() <= boundaryTime);
        return {
          messages: boundaryMessages,
          truncated: true,
          stopReason: 'result_limit',
          nextSince: new Date(boundaryTime + 1).toISOString(),
        };
      }
    }

    const nextProviderCursor = page.nextCursor ?? null;
    if (!nextProviderCursor) {
      return { messages: ordered, truncated: false, stopReason: 'window_exhausted', nextSince: null };
    }
    if (seenProviderCursors.has(nextProviderCursor)) {
      throw new GhlRecordingError('HighLevel export repeated a pagination cursor.');
    }
    seenProviderCursors.add(nextProviderCursor);
    providerCursor = nextProviderCursor;
  }

  // A hard page cap protects the Vercel function without creating the old
  // liveness trap. Advance only through a timestamp group that a later raw
  // provider message proved complete; otherwise fail and keep the old cursor.
  if (safeThroughTime === null || safeThroughTime < since) {
    throw new GhlRecordingError('HighLevel export page cap reached without a safe continuation.');
  }
  const ordered = results
    .filter(message => new Date(message.dateAdded!).getTime() <= safeThroughTime)
    .sort((a, b) => {
      const byDate = new Date(a.dateAdded!).getTime() - new Date(b.dateAdded!).getTime();
      return byDate || a.messageId.localeCompare(b.messageId);
    });
  return {
    messages: ordered,
    truncated: true,
    stopReason: 'provider_page_cap',
    nextSince: new Date(safeThroughTime + 1).toISOString(),
  };
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
