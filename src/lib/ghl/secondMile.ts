// GHL helpers for Workstream 7 (the second-mile task queue) that go beyond
// client.ts's original scope: fetching WON opportunities (the shared
// "installed this season" source for the cookies+ornament run, the
// reveal-photo prompt, and the cold-snap check-in) and resolving the crew
// list from SECOND_MILE_CREW_PHONE into GHL contact ids so a reveal-photo
// touch can actually be sent via sendConversationMessage (which requires a
// contact id, not a raw phone number). Uses the now-exported ghlFetch from
// client.ts rather than duplicating auth/base-URL/error handling.

import { ghlFetch, isHighLevelConfigured, searchContacts } from './client';
import type { HighLevelOpportunity } from './types';

// A crude but sufficient phone-vs-contact-id classifier: only digits, plus
// common phone punctuation (+, (), -, ., spaces), and at least 10 digits
// (a US number with area code, or an E.164 number with country code). A GHL
// contact id is an opaque alphanumeric string and never matches this.
export function looksLikePhoneNumber(entry: string): boolean {
  const trimmed = entry.trim();
  if (!/^[\d+().\-\s]+$/.test(trimmed)) return false;
  return trimmed.replace(/\D/g, '').length >= 10;
}

// Splits SECOND_MILE_CREW_PHONE on commas, trims, drops empties, dedupes.
// Pure -- no network -- so this is unit-testable on its own.
export function parseCrewList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const entry = part.trim();
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

// Resolves SECOND_MILE_CREW_PHONE into GHL contact ids. An entry that looks
// like a phone number is searched in GHL and the first match's id is used;
// anything else is assumed to already be a GHL contact id and passed
// through unresolved. Best-effort: an entry that fails to resolve is
// skipped (not thrown), same degrade-gracefully philosophy as the rest of
// the app -- a bad crew-list entry should never block sending to the rest
// of the crew.
export async function resolveCrewContactIds(raw: string | null | undefined): Promise<string[]> {
  if (!isHighLevelConfigured()) return [];
  const entries = parseCrewList(raw);
  const ids: string[] = [];
  for (const entry of entries) {
    if (!looksLikePhoneNumber(entry)) {
      ids.push(entry);
      continue;
    }
    try {
      const matches = await searchContacts(entry);
      if (matches[0]) ids.push(matches[0].id);
    } catch (err) {
      console.error(`Could not resolve crew phone entry to a GHL contact:`, err);
    }
  }
  return ids;
}

// Won/installed opportunities -- the shared source for the cookies+ornament
// run, the reveal-photo prompt, and the cold-snap check-in (see
// src/lib/secondMile/installedContacts.ts). Same location_id/status/limit
// shape as client.ts's getOpenOpportunities, just status=won instead of
// open; kept here rather than added to client.ts since it's specific to
// this workstream. Degrades to an empty array when HighLevel isn't
// configured, same convention as the rest of this app's optional-feature
// data sources.
export async function getWonOpportunities(limit = 100): Promise<HighLevelOpportunity[]> {
  if (!isHighLevelConfigured()) return [];
  const locationId = process.env.HIGHLEVEL_LOCATION_ID!;
  const params = new URLSearchParams({
    location_id: locationId,
    status: 'won',
    limit: String(Math.min(Math.max(limit, 1), 100)),
  });
  const json = await ghlFetch<{ opportunities?: HighLevelOpportunity[] }>(`/opportunities/search?${params}`);
  return json.opportunities ?? [];
}
