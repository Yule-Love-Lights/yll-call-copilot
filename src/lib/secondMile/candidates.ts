// Pure builders for second_mile_touches insert rows, plus the dedupe_key
// convention pinned in the 0013 migration's header comment. Kept pure (no
// Supabase, no Date.now() inside) so the nightly cron and the cold-snap
// endpoint can both build candidate rows and unit-test them without a live
// database -- the DB's unique constraint on dedupe_key is what actually
// enforces idempotency in production (upsert with ignoreDuplicates), but
// dedupeAgainstExisting below proves the same guarantee at the unit level.

import { createHash } from 'crypto';
import type { PersonalTouchDetail, SecondMileInsertCandidate, WonJobContact } from './types';

export function buildRevealPhotoDedupeKey(ghlContactId: string): string {
  return `reveal_photo:${ghlContactId}`;
}

export function buildYearlyDedupeKey(kind: 'cookies_ornament' | 'cold_snap_checkin', ghlContactId: string, year: number): string {
  return `${kind}:${ghlContactId}:${year}`;
}

// A stable short hash of the detail's content (not the transcript id, which
// is already the first key segment) -- the same detail extracted from the
// same transcript twice (e.g. a retried scan) hashes to the same key, so the
// unique constraint stops it from becoming a second row.
export function buildPersonalTouchDedupeKey(transcriptId: string, touch: Pick<PersonalTouchDetail, 'detail' | 'category' | 'quote'>): string {
  const hash = createHash('sha256')
    .update(`${touch.category}|${touch.detail}|${touch.quote}`)
    .digest('hex')
    .slice(0, 16);
  return `personal_touch:${transcriptId}:${hash}`;
}

export function buildCookiesOrnamentCandidates(contacts: WonJobContact[], year: number, now: Date = new Date()): SecondMileInsertCandidate[] {
  return contacts.map(c => ({
    ghl_contact_id: c.ghlContactId,
    customer_name: c.customerName,
    kind: 'cookies_ornament',
    status: 'pending',
    due_at: now.toISOString(),
    payload: { source: 'ghl_won_opportunity' },
    dedupe_key: buildYearlyDedupeKey('cookies_ornament', c.ghlContactId, year),
  }));
}

export function buildRevealPhotoCandidates(contacts: WonJobContact[], now: Date = new Date()): SecondMileInsertCandidate[] {
  return contacts.map(c => ({
    ghl_contact_id: c.ghlContactId,
    customer_name: c.customerName,
    kind: 'reveal_photo',
    status: 'pending',
    due_at: now.toISOString(),
    payload: { address: c.address },
    dedupe_key: buildRevealPhotoDedupeKey(c.ghlContactId),
  }));
}

export function buildColdSnapCandidates(contacts: WonJobContact[], year: number, now: Date = new Date()): SecondMileInsertCandidate[] {
  return contacts.map(c => ({
    ghl_contact_id: c.ghlContactId,
    customer_name: c.customerName,
    kind: 'cold_snap_checkin',
    status: 'pending',
    due_at: now.toISOString(),
    payload: { source: 'ghl_won_opportunity' },
    dedupe_key: buildYearlyDedupeKey('cold_snap_checkin', c.ghlContactId, year),
  }));
}

export function buildPersonalTouchCandidate(input: {
  transcriptId: string;
  ghlContactId: string | null;
  customerName: string | null;
  touch: PersonalTouchDetail;
  now?: Date;
}): SecondMileInsertCandidate {
  const now = input.now ?? new Date();
  return {
    ghl_contact_id: input.ghlContactId,
    customer_name: input.customerName,
    kind: 'personal_touch',
    status: 'pending',
    due_at: now.toISOString(),
    payload: {
      detail: input.touch.detail,
      category: input.touch.category,
      quote: input.touch.quote,
      transcript_id: input.transcriptId,
    },
    dedupe_key: buildPersonalTouchDedupeKey(input.transcriptId, input.touch),
  };
}

// Filters out any candidate whose dedupe_key is already known -- mirrors
// what the DB's unique constraint + upsert(..., {ignoreDuplicates: true})
// does in production, so a second cron run given the same GHL/transcript
// inputs (and thus the same candidate rows) produces zero new rows.
export function dedupeAgainstExisting<T extends { dedupe_key: string }>(
  candidates: T[],
  existingKeys: Iterable<string>,
): T[] {
  const seen = new Set(existingKeys);
  return candidates.filter(c => !seen.has(c.dedupe_key));
}
