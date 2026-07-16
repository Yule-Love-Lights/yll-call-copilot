// Coverage for the dedupe_key builders (the exact convention pinned in the
// 0013 migration's header comment) and the pure candidate-row builders the
// nightly cron and the cold-snap endpoint both use. dedupeAgainstExisting is
// what proves cron idempotency at the unit level: feeding a second "run"
// the first run's own dedupe keys as already-existing must yield zero new
// candidates, the same guarantee the DB's unique constraint + upsert
// ignoreDuplicates gives in production.

import { describe, it, expect } from 'vitest';
import {
  buildColdSnapCandidates,
  buildCookiesOrnamentCandidates,
  buildPersonalTouchCandidate,
  buildPersonalTouchDedupeKey,
  buildRevealPhotoCandidates,
  dedupeAgainstExisting,
} from './candidates';
import type { WonJobContact } from './types';

const CONTACT_A: WonJobContact = { ghlContactId: 'c_1', customerName: 'Jordan Rivera', address: '12 Elm St' };
const CONTACT_B: WonJobContact = { ghlContactId: 'c_2', customerName: 'Sam Lee', address: '9 Oak Ave' };

describe('dedupe_key builders', () => {
  it('reveal_photo has no year -- one touch ever per contact', () => {
    const [row] = buildRevealPhotoCandidates([CONTACT_A]);
    expect(row.dedupe_key).toBe('reveal_photo:c_1');
  });

  it('cookies_ornament and cold_snap_checkin are yearly', () => {
    const [ornament] = buildCookiesOrnamentCandidates([CONTACT_A], 2026);
    const [checkin] = buildColdSnapCandidates([CONTACT_A], 2026);
    expect(ornament.dedupe_key).toBe('cookies_ornament:c_1:2026');
    expect(checkin.dedupe_key).toBe('cold_snap_checkin:c_1:2026');
  });

  it('personal_touch keys off the transcript id and a hash of the detail, not the contact', () => {
    const key1 = buildPersonalTouchDedupeKey('t_1', { detail: "kid's name is Max", category: 'family', quote: 'our son Max' });
    const key2 = buildPersonalTouchDedupeKey('t_1', { detail: 'first Christmas in the new house', category: 'occasion', quote: 'first Christmas here' });
    expect(key1).toMatch(/^personal_touch:t_1:/);
    expect(key1).not.toBe(key2); // different detail -> different hash
  });

  it('personal_touch keys are stable for the same transcript+detail (same hash twice)', () => {
    const detail = { detail: "kid's name is Max", category: 'family', quote: 'our son Max' };
    expect(buildPersonalTouchDedupeKey('t_1', detail)).toBe(buildPersonalTouchDedupeKey('t_1', detail));
  });
});

describe('candidate builders carry the contact through', () => {
  it('buildCookiesOrnamentCandidates sets kind, status, due_at=now, and the contact fields', () => {
    const [row] = buildCookiesOrnamentCandidates([CONTACT_A], 2026);
    expect(row.kind).toBe('cookies_ornament');
    expect(row.status).toBe('pending');
    expect(row.ghl_contact_id).toBe('c_1');
    expect(row.customer_name).toBe('Jordan Rivera');
    expect(row.due_at).not.toBeNull();
  });

  it('buildRevealPhotoCandidates carries the address into payload', () => {
    const [row] = buildRevealPhotoCandidates([CONTACT_A]);
    expect(row.kind).toBe('reveal_photo');
    expect(row.payload).toMatchObject({ address: '12 Elm St' });
  });

  it('buildPersonalTouchCandidate stores detail/category/quote/transcript_id in payload', () => {
    const row = buildPersonalTouchCandidate({
      transcriptId: 't_9',
      ghlContactId: 'c_5',
      customerName: 'Alex',
      touch: { detail: 'anniversary in October', category: 'occasion', quote: 'our anniversary is in October' },
    });
    expect(row.kind).toBe('personal_touch');
    expect(row.payload).toMatchObject({
      detail: 'anniversary in October',
      category: 'occasion',
      quote: 'our anniversary is in October',
      transcript_id: 't_9',
    });
  });

  it('produces one row per contact', () => {
    const rows = buildCookiesOrnamentCandidates([CONTACT_A, CONTACT_B], 2026);
    expect(rows.map(r => r.dedupe_key)).toEqual(['cookies_ornament:c_1:2026', 'cookies_ornament:c_2:2026']);
  });
});

describe('dedupeAgainstExisting', () => {
  const candidates = buildCookiesOrnamentCandidates([CONTACT_A, CONTACT_B], 2026);

  it('a first run with no existing keys keeps every candidate', () => {
    expect(dedupeAgainstExisting(candidates, [])).toHaveLength(2);
  });

  it('a second run given the first run\'s own keys as existing produces zero new candidates (idempotency)', () => {
    const existingKeys = candidates.map(c => c.dedupe_key);
    expect(dedupeAgainstExisting(candidates, existingKeys)).toHaveLength(0);
  });

  it('only filters the overlapping key, leaving a genuinely new candidate through', () => {
    const existingKeys = [candidates[0].dedupe_key];
    const remaining = dedupeAgainstExisting(candidates, existingKeys);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].dedupe_key).toBe(candidates[1].dedupe_key);
  });
});
