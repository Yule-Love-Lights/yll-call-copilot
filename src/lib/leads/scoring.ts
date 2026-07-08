// Pure decision logic for the Phase 2 lead queue: which month plays which
// season card, whether a GHL signal (stage name / tag) counts as a match for
// one of the three lead sources, and whether a freshly-scored candidate
// should insert, refresh, or leave an existing queue row alone. No I/O here —
// src/lib/leads/queue.ts does the GHL/Supabase calls and calls into this
// module for every decision, same split as transcripts/outcomes.ts
// (classifyStageName is pure + tested; matchOutcome orchestrates).

import type { HighLevelContact, HighLevelOpportunity } from '../ghl/types';
import type { LeadSource, LeadStatus } from './types';

export const SCORE_INBOUND = 100;
export const SCORE_QUOTE_FOLLOWUP = 80;
export const SCORE_SEASON_PLAY = 60;

// ─── Keyword matching ──────────────────────────────────────────────────────
// Word-boundary, not a bare substring test: a bare `includes('new')` would
// false-positive inside "renewed" (a rebooked past customer, the opposite of
// a fresh inquiry) which matters a lot in this domain. Case-insensitive.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchesKeyword(text: string | null | undefined, keyword: string): boolean {
  if (!text) return false;
  return new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i').test(text);
}

export function matchesAnyKeyword(text: string | null | undefined, keywords: string[]): boolean {
  return keywords.some(k => matchesKeyword(text, k));
}

// ─── Time helpers ───────────────────────────────────────────────────────────
// `withinHours` guards against a future-dated timestamp (clock skew) being
// treated as "recent" — a negative diff must not satisfy the window.
export function withinHours(isoDate: string | null | undefined, hours: number, now: Date): boolean {
  if (!isoDate) return false;
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return false;
  const diffMs = now.getTime() - then;
  return diffMs >= 0 && diffMs <= hours * 60 * 60 * 1000;
}

export function olderThanDays(isoDate: string | null | undefined, days: number, now: Date): boolean {
  if (!isoDate) return false;
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return false;
  return now.getTime() - then >= days * 24 * 60 * 60 * 1000;
}

export function daysAgo(isoDate: string, now: Date): number {
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((now.getTime() - then) / (24 * 60 * 60 * 1000)));
}

// Used in the inbound-speed-to-lead reason line ("Reached out {when}").
export function humanizeRecency(isoDate: string, now: Date): string {
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return 'recently';
  const diffMs = Math.max(0, now.getTime() - then);
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours < 1) return 'just now';
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

// ─── Season play (month → play) ─────────────────────────────────────────────
// Aug-Nov: past holiday customers should be rebooking for this season.
// Dec-Jul: the rebook window has passed; pivot to a permanent-lighting
// upsell angle instead. UTC month, not local — parsing a date string and
// reading getMonth() in a negative-UTC-offset timezone can land a day early
// (e.g. "2026-08-01" reads as July 31 evening in US time zones), which would
// flip the Aug 1 / Dec 1 boundaries the brief calls out explicitly.
export function seasonPlay(date: Date): 'rebook' | 'permanent' {
  const month = date.getUTCMonth() + 1; // 1-12
  return month >= 8 && month <= 11 ? 'rebook' : 'permanent';
}

// ─── Source 1: inbound speed-to-lead ────────────────────────────────────────
// 'interested' and 'contacted' verified against the live GHL pipelines
// ("Interested In Services", "Contacted", "Interested"). 'open' deliberately
// excluded: "Previous Year Open" is a rebook signal, not a fresh inquiry.
const FRESH_INQUIRY_STAGE_KEYWORDS = ['new', 'lead', 'inquiry', 'quote requested', 'interested', 'contacted'];
const FRESH_INQUIRY_TAG_KEYWORDS = ['new lead', 'inquiry', 'quote requested', 'new inquiry'];

export function isFreshInquiry(stageName: string | null | undefined, tags: string[]): boolean {
  if (matchesAnyKeyword(stageName, FRESH_INQUIRY_STAGE_KEYWORDS)) return true;
  return tags.some(t => matchesAnyKeyword(t, FRESH_INQUIRY_TAG_KEYWORDS));
}

// ─── Source 2: quote follow-ups ─────────────────────────────────────────────
// 'bid' verified against the live GHL pipelines ("📨Bid Sent", "Bid Sent").
const QUOTE_WORD_KEYWORDS = ['quote', 'estimate', 'proposal', 'bid'];
const SENT_WORD_KEYWORDS = ['sent', 'delivered'];

export function isQuoteSentStage(stageName: string | null | undefined): boolean {
  return matchesAnyKeyword(stageName, QUOTE_WORD_KEYWORDS) && matchesAnyKeyword(stageName, SENT_WORD_KEYWORDS);
}

// ─── Source 3: season play ───────────────────────────────────────────────────
// Intentionally conservative tag list (not a bare "customer") — the signal
// needs to say PAST customer, not just any current contact tagged customer.
// Tunable if real GHL tag conventions turn out different once verified live.
const PAST_CUSTOMER_TAG_KEYWORDS = ['past customer', 'former customer', 'holiday customer', 'existing customer'];
const REBOOKED_TAG_KEYWORDS = ['rebooked', 'rebook', 'renewed', 'renewal'];
const REBOOKED_STAGE_KEYWORDS = ['rebook', 'renewed', 'renewal'];
const PERMANENT_TAG_KEYWORDS = ['permanent lighting', 'permanent', 'year-round lighting', 'year round lighting'];
const PERMANENT_STAGE_KEYWORDS = ['permanent'];

// Stage names verified live: "Previous Year Open", "Previous Year Quotes",
// "November Reengagement", "🎄End of Year" all mark last season's customers.
const PAST_CUSTOMER_STAGE_KEYWORDS = ['previous year', 'reengagement', 'end of year'];

export function isPastCustomer(tags: string[], openStageNames: string[] = []): boolean {
  if (tags.some(t => matchesAnyKeyword(t, PAST_CUSTOMER_TAG_KEYWORDS))) return true;
  return openStageNames.some(s => matchesAnyKeyword(s, PAST_CUSTOMER_STAGE_KEYWORDS));
}

// ─── Do-not-call gate ────────────────────────────────────────────────────────
// Verified live: this GHL location has "DO NOT CALL", "Spam Calls", and
// "Pause Communications Until October" stages, and contacts carry a `dnd`
// flag. A contact matching ANY of these must never enter the call queue,
// whatever the other signals say.
const DO_NOT_CALL_KEYWORDS = ['do not call', 'dnc', 'spam', 'pause communications'];

export function isCallable(input: { dnd?: boolean | null; tags: string[]; stageNames: string[] }): boolean {
  if (input.dnd === true) return false;
  if (input.tags.some(t => matchesAnyKeyword(t, DO_NOT_CALL_KEYWORDS))) return false;
  if (input.stageNames.some(s => matchesAnyKeyword(s, DO_NOT_CALL_KEYWORDS))) return false;
  return true;
}

// GET /api/inbound/recent's lazy lead auto-create (a webhook-logged inbound
// call/text with no existing `leads` row yet) used to insert a plain
// 'queued' row with zero DNC check at all. This is the pure decision for
// that insert: a contact we could positively confirm callable (dnd/tags/
// stage all clear) is queued normally; anything else — including "we could
// not verify" (HighLevel not configured, or the hydration call failed) —
// inserts 'dismissed' with a DNC-flagged reason instead. The screen-pop
// (src/app/InboundPop.tsx) still shows the card either way (staff should
// know the phone is ringing), but GET /api/queue only ever lists
// 'queued'/'claimed' rows, so a dismissed row can never render as a
// callable queue entry.
export type InboundAutoCreateFields = {
  reason: string;
  opener_hint: string;
  score: number;
  source: 'inbound';
  status: 'queued' | 'dismissed';
};

export function buildInboundAutoCreateFields(callable: boolean): InboundAutoCreateFields {
  if (callable) {
    return { reason: 'Inbound call just now', opener_hint: 'Inbound follow-up', score: SCORE_INBOUND, source: 'inbound', status: 'queued' };
  }
  return {
    reason: 'DNC - do not call back (inbound call just now)',
    opener_hint: 'Inbound follow-up',
    score: SCORE_INBOUND,
    source: 'inbound',
    status: 'dismissed',
  };
}

export function hasRebookedThisSeason(tags: string[], openStageNames: string[]): boolean {
  if (tags.some(t => matchesAnyKeyword(t, REBOOKED_TAG_KEYWORDS))) return true;
  return openStageNames.some(s => matchesAnyKeyword(s, REBOOKED_STAGE_KEYWORDS));
}

export function hasPermanentLightingSignal(tags: string[], openStageNames: string[]): boolean {
  if (tags.some(t => matchesAnyKeyword(t, PERMANENT_TAG_KEYWORDS))) return true;
  return openStageNames.some(s => matchesAnyKeyword(s, PERMANENT_STAGE_KEYWORDS));
}

// ─── Candidate shape ─────────────────────────────────────────────────────────
export type LeadCandidate = {
  ghl_contact_id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  vertical_slug: string | null;
  reason: string;
  opener_hint: string;
  score: number;
  source: LeadSource;
  // Contact-local IANA time zone, for the TCPA calling-hours gate
  // (src/lib/leads/callingHours.ts) — null when GHL never returned one.
  timezone: string | null;
};

function contactFullName(contact: HighLevelContact): string | null {
  if (contact.contactName) return contact.contactName;
  const joined = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
  return joined || null;
}

// ─── Candidate builders (pure — given already-fetched GHL data) ────────────

export type InboundCandidateInput = {
  contact: HighLevelContact;
  stageName: string | null;
  now: Date;
};

export function buildInboundCandidate(input: InboundCandidateInput): LeadCandidate | null {
  const { contact, stageName, now } = input;
  const recentIso = contact.dateUpdated ?? contact.dateAdded ?? null;
  if (!withinHours(recentIso, 48, now)) return null;
  if (!isFreshInquiry(stageName, contact.tags ?? [])) return null;

  return {
    ghl_contact_id: contact.id,
    full_name: contactFullName(contact),
    phone: contact.phone ?? null,
    email: contact.email ?? null,
    address: contact.address1 ?? null,
    vertical_slug: null,
    reason: `Reached out ${humanizeRecency(recentIso as string, now)} - call back fast`,
    opener_hint: 'Inbound follow-up',
    score: SCORE_INBOUND,
    source: 'inbound_speed',
    timezone: contact.timezone ?? null,
  };
}

// Minimal contact shape, not a full HighLevelContact: in queue.ts this comes
// from a getContact() hydration (CrmContact) that normalizes down to this
// before scoring. dnd/tags/timezone are carried through (unlike
// name/email/phone, which are cosmetic) because the do-not-call gate and the
// TCPA calling-hours gate both need them.
export type MinimalContact = {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  dnd?: boolean | null;
  tags?: string[];
  timezone?: string | null;
};

export type QuoteFollowupCandidateInput = {
  opportunity: HighLevelOpportunity;
  stageName: string | null;
  contact: MinimalContact;
  now: Date;
};

export function buildQuoteFollowupCandidate(input: QuoteFollowupCandidateInput): LeadCandidate | null {
  const { opportunity, stageName, contact, now } = input;
  if (opportunity.status === 'won' || opportunity.status === 'lost') return null;
  if (!isQuoteSentStage(stageName)) return null;
  const ageIso = opportunity.updatedAt ?? opportunity.createdAt ?? null;
  if (!olderThanDays(ageIso, 3, now)) return null;

  const days = ageIso ? daysAgo(ageIso, now) : 3;
  return {
    ghl_contact_id: contact.id,
    full_name: contact.name ?? null,
    phone: contact.phone ?? null,
    email: contact.email ?? null,
    address: null,
    vertical_slug: null,
    reason: `Quote sent ${days} day${days === 1 ? '' : 's'} ago, no decision`,
    opener_hint: 'Quote follow-up',
    score: SCORE_QUOTE_FOLLOWUP,
    source: 'quote_followup',
    timezone: contact.timezone ?? null,
  };
}

export type SeasonPlayCandidateInput = {
  contact: HighLevelContact;
  openStageNames: string[]; // this contact's own open opportunities' stage names
  play: 'rebook' | 'permanent';
};

export function buildSeasonPlayCandidate(input: SeasonPlayCandidateInput): LeadCandidate | null {
  const { contact, openStageNames, play } = input;
  const tags = contact.tags ?? [];
  if (!isPastCustomer(tags, openStageNames)) return null;

  // The play itself names the vertical: rebook season is the holiday book,
  // the off-season play pitches permanent. Slugs match the seeded defaults
  // (src/lib/playbook/seed.ts) so the call console can find the playbook.
  // Inbound/quote candidates stay null — GHL alone doesn't say which line
  // of business a fresh inquiry or open quote is for.
  const base = {
    ghl_contact_id: contact.id,
    full_name: contactFullName(contact),
    phone: contact.phone ?? null,
    email: contact.email ?? null,
    address: contact.address1 ?? null,
    opener_hint: 'Past customer',
    score: SCORE_SEASON_PLAY,
    source: 'season_play' as const,
    timezone: contact.timezone ?? null,
  };

  if (play === 'rebook') {
    if (hasRebookedThisSeason(tags, openStageNames)) return null;
    return { ...base, vertical_slug: 'holiday', reason: 'Rebook season - was a customer last year' };
  }

  if (hasPermanentLightingSignal(tags, openStageNames)) return null;
  return { ...base, vertical_slug: 'permanent', reason: 'Permanent lighting upsell candidate' };
}

// ─── Upsert decision ─────────────────────────────────────────────────────────
export type ExistingLeadForUpsert = { id: string; status: LeadStatus };
export type UpsertDecision = { action: 'insert' } | { action: 'update'; leadId: string } | { action: 'skip' };

// "refresh reason/score if already queued; never duplicate; never touch
// claimed/done rows" (brief, verbatim) — read literally: only an existing
// row still sitting at 'queued' gets refreshed. A 'dismissed' row was a
// deliberate rep decision, so a rebuild leaves it alone too, same as
// claimed/done, rather than silently resurrecting it into the active queue.
export function decideUpsert(existing: ExistingLeadForUpsert | null): UpsertDecision {
  if (!existing) return { action: 'insert' };
  if (existing.status === 'queued') return { action: 'update', leadId: existing.id };
  return { action: 'skip' };
}
