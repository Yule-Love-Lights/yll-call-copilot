// HighLevel (GoHighLevel / LeadConnector) API client. Ported from the AI
// Quote Tool's integration layer (src/lib/integrations/highlevel.ts), trimmed
// to Phase 0's needs: contact search and contact fetch by id. Opportunities,
// conversations, and messages are dropped here — not needed yet.
//
// Auth: Private Integration token scoped to a single Location. Uses the same
// env var names as the quote tool (HIGHLEVEL_API_KEY / HIGHLEVEL_LOCATION_ID)
// so the same token works across both apps.
//
// Docs: https://highlevel.stoplight.io/docs/integrations/
// API base: https://services.leadconnectorhq.com
// Version header: Version: 2021-07-28  (required — the gateway 400s without it)

import type { CrmContact, HighLevelContact, HighLevelOpportunity } from './types';

const API_BASE = 'https://services.leadconnectorhq.com';
const API_VERSION_HEADER = '2021-07-28';

export class HighLevelError extends Error {
  constructor(message: string, public status?: number, public body?: string) {
    super(message);
    this.name = 'HighLevelError';
  }
}

const MAX_IDEMPOTENT_GET_ATTEMPTS = 3;
const GHL_REQUEST_TIMEOUT_MS = 20_000;
const RETRYABLE_GET_STATUSES = new Set([429, 500, 502, 503, 504]);

function retryDelayMs(response: Response | null, attempt: number): number {
  const retryAfter = response?.headers?.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(10_000, Math.max(0, seconds * 1000));
    const dateMs = new Date(retryAfter).getTime();
    if (Number.isFinite(dateMs)) return Math.min(10_000, Math.max(0, dateMs - Date.now()));
  }
  return Math.min(2000, 250 * 2 ** (attempt - 1));
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isHighLevelConfigured(): boolean {
  return !!(process.env.HIGHLEVEL_API_KEY && process.env.HIGHLEVEL_LOCATION_ID);
}

// Deep link to a contact's page in the GHL web app, for the call console's
// "open in GoHighLevel" link. Centralized here (not in a route) so the
// location id — a server-only env var, never sent to the browser as-is —
// only ever gets read in one place.
export function getContactPageUrl(contactId: string): string | null {
  const locationId = process.env.HIGHLEVEL_LOCATION_ID;
  if (!locationId) return null;
  return `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/${encodeURIComponent(contactId)}`;
}

function requireConfig(): { apiKey: string; locationId: string } {
  const apiKey = process.env.HIGHLEVEL_API_KEY;
  const locationId = process.env.HIGHLEVEL_LOCATION_ID;
  if (!apiKey || !locationId) {
    throw new HighLevelError(
      'HighLevel not configured. Set HIGHLEVEL_API_KEY and HIGHLEVEL_LOCATION_ID in .env.local',
    );
  }
  return { apiKey, locationId };
}

export async function ghlFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { apiKey } = requireConfig();
  const method = (init.method ?? 'GET').toUpperCase();
  const maxAttempts = method === 'GET' ? MAX_IDEMPOTENT_GET_ATTEMPTS : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(GHL_REQUEST_TIMEOUT_MS),
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Version': API_VERSION_HEADER,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      if (attempt < maxAttempts) {
        await wait(retryDelayMs(null, attempt));
        continue;
      }
      throw error;
    }

    if (res.ok) return res.json() as Promise<T>;
    if (attempt < maxAttempts && RETRYABLE_GET_STATUSES.has(res.status)) {
      await wait(retryDelayMs(res, attempt));
      continue;
    }

    const body = await res.text().catch(() => '');
    throw new HighLevelError(
      `HighLevel ${method} ${path} → ${res.status}: ${body.slice(0, 400)}`,
      res.status,
      body.slice(0, 2000),
    );
  }

  throw new HighLevelError(`HighLevel ${method} ${path} exhausted retries.`);
}

// ─── Contact search ───────────────────────────────────────────────────────
// Rep types a name/email/phone; we search HighLevel; they pick the match.
//
// Endpoint: GET /contacts/?locationId=...&query=...
// Returns up to 20 matches by default. If we need more later, switch to the
// /contacts/search POST endpoint which supports richer filtering.
export async function searchContacts(query: string, limit = 20): Promise<CrmContact[]> {
  if (!query.trim()) return [];
  const { locationId } = requireConfig();
  const params = new URLSearchParams({
    locationId,
    query: query.trim(),
    limit: String(Math.min(Math.max(limit, 1), 100)),
  });
  const json = await ghlFetch<{ contacts?: HighLevelContact[] }>(`/contacts/?${params}`);
  return (json.contacts ?? []).map(toCrmContact);
}

// ─── Contact fetch ────────────────────────────────────────────────────────
// Hydrates a full contact record when the caller already has a contactId.
export async function getContact(contactId: string): Promise<CrmContact> {
  const json = await ghlFetch<{ contact: HighLevelContact }>(
    `/contacts/${encodeURIComponent(contactId)}`,
  );
  return toCrmContact(json.contact);
}

// ─── Contact listing (no query) ─────────────────────────────────────────────
// Used by the Phase 2 lead-queue builder (src/lib/leads/queue.ts) to scan a
// page of contacts for recency (inbound speed-to-lead) and tags (season
// play), where searchContacts()'s required free-text query doesn't apply.
// Same endpoint and shape as searchContacts, `query` just omitted — returns
// the raw HighLevel record (not the redacted CrmContact) because the queue
// builder needs `tags` and the date fields, which CrmContact deliberately
// drops before anything reaches the browser.
//
// One page only, capped at HighLevel's 100-per-page ceiling (same cap
// searchContacts already applies) — no pagination loop. Good enough for a
// human-triggered "Build queue" button; a dormant past customer who hasn't
// touched GHL recently may fall outside this page, which is a known
// limitation of scoring off one page rather than the full contact list.
export async function listContacts(limit = 100): Promise<HighLevelContact[]> {
  const { locationId } = requireConfig();
  const params = new URLSearchParams({ locationId, limit: String(Math.min(Math.max(limit, 1), 100)) });
  const json = await ghlFetch<{ contacts?: HighLevelContact[] }>(`/contacts/?${params}`);
  return json.contacts ?? [];
}

// ─── Opportunities (by contact) ───────────────────────────────────────────
// Used by the Phase 1.5 transcript outcome matcher (src/lib/transcripts/
// outcomes.ts) to inspect a contact's pipeline stage. Unlike the AI Quote
// Tool's findOpportunityForContact, this omits pipeline_id — the call
// copilot isn't pinned to one pipeline, so a contact's opportunities can
// live in any of them.
//
// Endpoint: GET /opportunities/search?location_id=...&contact_id=...
// Note the snake_case query params — this endpoint predates the rest of the
// v2 gateway's camelCase convention (same quirk ported in the quote tool).
export async function getOpportunitiesForContact(contactId: string): Promise<HighLevelOpportunity[]> {
  const { locationId } = requireConfig();
  const params = new URLSearchParams({ location_id: locationId, contact_id: contactId });
  const json = await ghlFetch<{ opportunities?: HighLevelOpportunity[] }>(`/opportunities/search?${params}`);
  return json.opportunities ?? [];
}

// ─── Open opportunities (all contacts) ─────────────────────────────────────
// Used by the Phase 2 lead-queue builder to find quote-follow-up candidates
// across every pipeline in one call, instead of one getOpportunitiesForContact
// call per contact. Same snake_case query param quirk as above.
export async function getOpenOpportunities(limit = 100): Promise<HighLevelOpportunity[]> {
  const { locationId } = requireConfig();
  const params = new URLSearchParams({
    location_id: locationId,
    status: 'open',
    limit: String(Math.min(Math.max(limit, 1), 100)),
  });
  const json = await ghlFetch<{ opportunities?: HighLevelOpportunity[] }>(`/opportunities/search?${params}`);
  return json.opportunities ?? [];
}

// ─── Pipeline stage names ──────────────────────────────────────────────────
// Flattens every pipeline's stage list into a stageId -> stageName map so the
// outcome matcher can classify an opportunity's pipelineStageId by NAME
// keywords (this app has no HIGHLEVEL_STAGE_* env vars to pin exact ids —
// see outcomes.ts). Callers should fetch this once per ingest run and pass
// the map through, rather than refetching per transcript.
//
// Endpoint: GET /opportunities/pipelines?locationId=...
export async function getStageNameMap(): Promise<Map<string, string>> {
  const { locationId } = requireConfig();
  const json = await ghlFetch<{ pipelines?: { stages?: { id?: string; name?: string }[] }[] }>(
    `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
  );
  const map = new Map<string, string>();
  for (const pipeline of json.pipelines ?? []) {
    for (const stage of pipeline.stages ?? []) {
      if (stage.id) map.set(stage.id, stage.name ?? '');
    }
  }
  return map;
}

// ─── Conversations: send email / SMS ───────────────────────────────────────
// Used by the Phase 2 call console's follow-up drafts (src/lib/leads/
// followups.ts and POST /api/followups/[id]/send) to send a rep-approved
// draft to a contact. Every call here is a real customer-facing message —
// the route wrapping this gates on GHL_SEND_ENABLED and a human click; this
// function itself does not gate anything, so never call it from anywhere
// that isn't already past both of those checks.
//
// Endpoint: POST /conversations/messages, best-effort shape (not verified
// against a live payload) — HighLevel's conversations API distinguishes
// message type by the `type` field, "Email" or "SMS".
export type SendMessageInput =
  | { type: 'Email'; contactId: string; subject: string; html: string }
  | { type: 'SMS'; contactId: string; message: string };

export async function sendConversationMessage(input: SendMessageInput): Promise<{ messageId: string | null }> {
  const { locationId } = requireConfig();
  const body =
    input.type === 'Email'
      ? { type: 'Email', contactId: input.contactId, locationId, subject: input.subject, html: input.html }
      : { type: 'SMS', contactId: input.contactId, locationId, message: input.message };
  const json = await ghlFetch<{ messageId?: string }>('/conversations/messages', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  // A conversation id is shared by many messages and is not delivery
  // evidence for this exact send attempt. Return only the provider's message
  // id; callers must treat a 2xx response without one as uncertain.
  return { messageId: json.messageId ?? null };
}

// ─── Mapper: HighLevel → CrmContact ───────────────────────────────────────
// Centralized so a schema drift on GHL's side only breaks here, not in every
// consumer. Never forwards the raw HighLevel record — only the fields the
// app actually needs.
function toCrmContact(hl: HighLevelContact): CrmContact {
  return {
    id: hl.id,
    source: 'highlevel',
    firstName: hl.firstName,
    lastName: hl.lastName,
    fullName:
      hl.contactName ??
      ([hl.firstName, hl.lastName].filter(Boolean).join(' ') || undefined),
    email: hl.email,
    phone: hl.phone,
    address1: hl.address1,
    city: hl.city,
    state: hl.state,
    postalCode: hl.postalCode,
    dnd: hl.dnd,
    dndSettings: hl.dndSettings,
    tags: hl.tags,
    timezone: hl.timezone,
  };
}
