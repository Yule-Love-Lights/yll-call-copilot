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

export function isHighLevelConfigured(): boolean {
  return !!(process.env.HIGHLEVEL_API_KEY && process.env.HIGHLEVEL_LOCATION_ID);
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

async function ghlFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { apiKey } = requireConfig();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Version': API_VERSION_HEADER,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new HighLevelError(
      `HighLevel ${init.method ?? 'GET'} ${path} → ${res.status}: ${body.slice(0, 400)}`,
      res.status,
      body.slice(0, 2000),
    );
  }
  return res.json() as Promise<T>;
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
  };
}
