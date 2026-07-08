// Phase 5 analytics: pure aggregation over already-fetched rows (computeStats,
// attributeVersion, topNoiseCardTexts, the date-range helpers — all
// unit-tested with fixture rows), plus a loader (loadStatsInputs/loadStats)
// that does the actual Supabase queries. Same split as
// src/lib/transcripts/insights.ts's computeInsights: the route stays a thin
// orchestrator, the aggregation is the part worth testing hard.
//
// Consumed by GET /api/analytics (a single vertical + date range) and
// POST /api/verticals/[id]/brain-review (same loader, a periodDays-derived
// range) so both surfaces compute stats identically.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '../supabase';
import { CALL_OUTCOMES, type CallOutcome } from '../leads/types';
import type { RepRating } from '../live/types';
import type { TranscriptOutcome } from '../transcripts/types';

// ─── Date / period helpers (pure) ───────────────────────────────────────────

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function toDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function isValidDateStr(s: string | null | undefined): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return !Number.isNaN(Date.parse(`${s}T00:00:00.000Z`));
}

// GET /api/analytics's ?from=&to= — defaults to the last 30 days when either
// is missing/malformed, and swaps a backwards range rather than erroring
// (a picker firing from>to mid-edit shouldn't 400).
export function parseDateRange(
  fromParam: string | null | undefined,
  toParam: string | null | undefined,
  now: Date = new Date(),
): { from: string; to: string } {
  const defaultTo = toDateStr(now);
  const defaultFrom = toDateStr(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
  const from = isValidDateStr(fromParam) ? fromParam : defaultFrom;
  const to = isValidDateStr(toParam) ? toParam : defaultTo;
  return from <= to ? { from, to } : { from: to, to: from };
}

// POST /api/verticals/[id]/brain-review's {periodDays} — defaults to 7,
// same "don't 400 on a bad optional number" leniency as GET /api/queue's
// ?minScore=.
export function periodFromDays(periodDays: number, now: Date = new Date()): { periodStart: string; periodEnd: string } {
  const days = Number.isFinite(periodDays) && periodDays > 0 ? Math.floor(periodDays) : 7;
  const periodEnd = toDateStr(now);
  const periodStart = toDateStr(new Date(now.getTime() - days * 24 * 60 * 60 * 1000));
  return { periodStart, periodEnd };
}

// Inclusive whole-day bounds in UTC for a `gte`/`lte` timestamptz query.
export function dateRangeToTimestamps(from: string, to: string): { startIso: string; endIso: string } {
  return { startIso: `${from}T00:00:00.000Z`, endIso: `${to}T23:59:59.999Z` };
}

// Every YYYY-MM-DD from `from` to `to` inclusive, for the zero-filled trend.
// Guarded against a runaway loop even though callers only ever pass an
// already-normalized (from <= to) range.
function enumerateDates(from: string, to: string): string[] {
  const dates: string[] = [];
  let cursor = new Date(`${from}T00:00:00.000Z`).getTime();
  const end = new Date(`${to}T00:00:00.000Z`).getTime();
  let guard = 0;
  while (cursor <= end && guard < 3660) {
    dates.push(toDateStr(new Date(cursor)));
    cursor += 24 * 60 * 60 * 1000;
    guard++;
  }
  return dates;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─── Version attribution (pure) ─────────────────────────────────────────────

// "Which playbook version was active when this call happened" has no
// historical record — verticals.active_version only ever holds the CURRENT
// version, and playbook_versions has no "activated_at" of its own. This
// approximates it as the newest version whose created_at is at or before the
// call's started_at (versions are assumed to activate immediately on
// creation, same as every version-publish route in this app already does).
// A call that predates every version for its vertical has no attributable
// version and is left out of the by-version breakdown entirely, rather than
// guessed at.
export function attributeVersion(startedAt: string, versions: { version: number; createdAt: string }[]): number | null {
  const startedMs = new Date(startedAt).getTime();
  let best: number | null = null;
  for (const v of versions) {
    const createdMs = new Date(v.createdAt).getTime();
    if (Number.isNaN(createdMs) || createdMs > startedMs) continue;
    if (best === null || v.version > best) best = v.version;
  }
  return best;
}

// ─── Noise-rated coaching cards (pure) ──────────────────────────────────────

// Feeds the brain-review's coaching feedback loop: the most repeated
// noise-rated card texts, so the prompt can ask Claude to consider an
// avoid-list or trigger-tuning proposal when one looks genuinely unhelpful.
// Dedupes case-insensitively, same rationale as insights.ts's topByFrequency.
export function topNoiseCardTexts(
  events: { cardText: string; repRating: RepRating | null }[],
  limit = 5,
): { text: string; count: number }[] {
  const counts = new Map<string, { display: string; count: number }>();
  for (const e of events) {
    if (e.repRating !== 'noise') continue;
    const trimmed = e.cardText.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { display: trimmed, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map(({ display, count }) => ({ text: display, count }));
}

// ─── Aggregation (pure) ──────────────────────────────────────────────────────

export type OutcomeCounts = Record<CallOutcome, number>;
export type OpenerStat = { openerHint: string; calls: number; interested: number; interestedRate: number };
export type VersionStat = { version: number; calls: number; interested: number; interestedRate: number };
export type TrendPoint = { date: string; calls: number };

export type StatsCallRow = { id: string; outcome: CallOutcome | null; startedAt: string; openerHint: string | null };
export type StatsFollowupRow = { status: string };
export type StatsCoachingRow = { cardText: string; repRating: RepRating | null };
export type StatsPlaybookVersionRow = { version: number; createdAt: string };
export type StatsTranscriptRow = { outcome: TranscriptOutcome };

export type StatsInputs = {
  from: string;
  to: string;
  calls: StatsCallRow[];
  followups: StatsFollowupRow[];
  coachingEvents: StatsCoachingRow[];
  playbookVersions: StatsPlaybookVersionRow[];
  transcripts: StatsTranscriptRow[];
};

export type StatsResult = {
  from: string;
  to: string;
  totalCalls: number;
  callsByOutcome: OutcomeCounts;
  // Calls with no outcome yet (e.g. a live-coached call the rep never
  // finished tagging) — counted in totalCalls but not in callsByOutcome or
  // the connect rate's numerator.
  noOutcomeCalls: number;
  connectRate: number; // percent, 1 decimal — share of calls that were not voicemail/no_answer
  interestedCount: number;
  interestedRate: number; // percent, 1 decimal
  byOpener: OpenerStat[];
  byVersion: VersionStat[];
  followupsSent: number;
  coaching: { helpful: number; noise: number; helpfulRate: number };
  transcripts: { booked: number; notBooked: number; unknown: number; total: number };
  trend: TrendPoint[];
};

// Outcomes that mean "the phone was never really answered" — everything
// else (interested/callback/not_interested/wrong_number) means a human
// picked up, whatever they decided.
const NON_CONNECT_OUTCOMES: readonly CallOutcome[] = ['voicemail', 'no_answer'];

export function computeStats(inputs: StatsInputs): StatsResult {
  const { calls, followups, coachingEvents, playbookVersions, transcripts, from, to } = inputs;

  const callsByOutcome = Object.fromEntries(CALL_OUTCOMES.map(o => [o, 0])) as OutcomeCounts;
  let noOutcomeCalls = 0;
  for (const call of calls) {
    if (call.outcome) callsByOutcome[call.outcome]++;
    else noOutcomeCalls++;
  }
  const totalCalls = calls.length;

  const connectedCount = CALL_OUTCOMES.filter(o => !NON_CONNECT_OUTCOMES.includes(o)).reduce(
    (sum, o) => sum + callsByOutcome[o],
    0,
  );
  const connectRate = totalCalls > 0 ? round1((connectedCount / totalCalls) * 100) : 0;

  const interestedCount = callsByOutcome.interested;
  const interestedRate = totalCalls > 0 ? round1((interestedCount / totalCalls) * 100) : 0;

  // Interested rate by opener_hint.
  const openerBuckets = new Map<string, { calls: number; interested: number }>();
  for (const call of calls) {
    const key = call.openerHint?.trim() || '(none)';
    const bucket = openerBuckets.get(key) ?? { calls: 0, interested: 0 };
    bucket.calls++;
    if (call.outcome === 'interested') bucket.interested++;
    openerBuckets.set(key, bucket);
  }
  const byOpener: OpenerStat[] = [...openerBuckets.entries()]
    .map(([openerHint, b]) => ({
      openerHint,
      calls: b.calls,
      interested: b.interested,
      interestedRate: b.calls > 0 ? round1((b.interested / b.calls) * 100) : 0,
    }))
    .sort((a, b) => b.calls - a.calls || a.openerHint.localeCompare(b.openerHint));

  // Interested rate by attributed playbook version.
  const versionBuckets = new Map<number, { calls: number; interested: number }>();
  for (const call of calls) {
    const version = attributeVersion(call.startedAt, playbookVersions);
    if (version === null) continue;
    const bucket = versionBuckets.get(version) ?? { calls: 0, interested: 0 };
    bucket.calls++;
    if (call.outcome === 'interested') bucket.interested++;
    versionBuckets.set(version, bucket);
  }
  const byVersion: VersionStat[] = [...versionBuckets.entries()]
    .map(([version, b]) => ({
      version,
      calls: b.calls,
      interested: b.interested,
      interestedRate: b.calls > 0 ? round1((b.interested / b.calls) * 100) : 0,
    }))
    .sort((a, b) => a.version - b.version);

  const followupsSent = followups.filter(f => f.status === 'approved_sent').length;

  const helpful = coachingEvents.filter(e => e.repRating === 'helpful').length;
  const noise = coachingEvents.filter(e => e.repRating === 'noise').length;
  const helpfulRate = helpful + noise > 0 ? round1((helpful / (helpful + noise)) * 100) : 0;

  const booked = transcripts.filter(t => t.outcome === 'booked').length;
  const notBooked = transcripts.filter(t => t.outcome === 'not_booked').length;
  const unknown = transcripts.filter(t => t.outcome === 'unknown').length;

  // Calls/day trend, zero-filled for days with none. started_at is a
  // Postgres timestamptz serialized in UTC, so its first 10 characters are
  // always the UTC calendar date — no Date-object timezone math needed.
  const trendMap = new Map<string, number>();
  for (const call of calls) {
    const day = call.startedAt.slice(0, 10);
    trendMap.set(day, (trendMap.get(day) ?? 0) + 1);
  }
  const trend: TrendPoint[] = enumerateDates(from, to).map(date => ({ date, calls: trendMap.get(date) ?? 0 }));

  return {
    from,
    to,
    totalCalls,
    callsByOutcome,
    noOutcomeCalls,
    connectRate,
    interestedCount,
    interestedRate,
    byOpener,
    byVersion,
    followupsSent,
    coaching: { helpful, noise, helpfulRate },
    transcripts: { booked, notBooked, unknown, total: transcripts.length },
    trend,
  };
}

// ─── Loader (Supabase I/O) ───────────────────────────────────────────────────

export type LoadStatsInputsResult = { ok: true; inputs: StatsInputs } | { ok: false; missingTable: boolean };

// calls has no vertical column of its own (only its lead does, via
// vertical_slug) — same join-through-leads shape computeInsights() uses for
// transcripts/learnings, done here in JS rather than a PostgREST embedded
// filter to match that established style.
export async function loadStatsInputs(
  supabase: SupabaseClient,
  params: { verticalId: string; verticalSlug: string; from: string; to: string },
): Promise<LoadStatsInputsResult> {
  const { verticalId, verticalSlug, from, to } = params;
  const { startIso, endIso } = dateRangeToTimestamps(from, to);

  const { data: leadRows, error: leadsError } = await supabase
    .from('leads')
    .select('id, opener_hint')
    .eq('vertical_slug', verticalSlug);
  if (leadsError) {
    if (!isMissingTableError(leadsError)) console.error('Load leads for analytics failed:', leadsError);
    return { ok: false, missingTable: isMissingTableError(leadsError) };
  }
  const leads = (leadRows ?? []) as { id: string; opener_hint: string | null }[];
  const openerByLead = new Map(leads.map(l => [l.id, l.opener_hint]));
  const leadIds = leads.map(l => l.id);

  let calls: StatsCallRow[] = [];
  let callIds: string[] = [];
  if (leadIds.length > 0) {
    const { data: callRows, error: callsError } = await supabase
      .from('calls')
      .select('id, lead_id, outcome, started_at')
      .in('lead_id', leadIds)
      .gte('started_at', startIso)
      .lte('started_at', endIso);
    if (callsError) {
      if (!isMissingTableError(callsError)) console.error('Load calls for analytics failed:', callsError);
      return { ok: false, missingTable: isMissingTableError(callsError) };
    }
    const rows = (callRows ?? []) as { id: string; lead_id: string | null; outcome: CallOutcome | null; started_at: string }[];
    calls = rows.map(r => ({
      id: r.id,
      outcome: r.outcome,
      startedAt: r.started_at,
      openerHint: r.lead_id ? (openerByLead.get(r.lead_id) ?? null) : null,
    }));
    callIds = rows.map(r => r.id);
  }

  let followups: StatsFollowupRow[] = [];
  let coachingEvents: StatsCoachingRow[] = [];
  if (callIds.length > 0) {
    const { data: followupRows, error: followupsError } = await supabase.from('followups').select('status').in('call_id', callIds);
    if (followupsError) {
      if (!isMissingTableError(followupsError)) console.error('Load followups for analytics failed:', followupsError);
      return { ok: false, missingTable: isMissingTableError(followupsError) };
    }
    followups = (followupRows ?? []) as StatsFollowupRow[];

    const { data: coachingRows, error: coachingError } = await supabase
      .from('coaching_events')
      .select('card_text, rep_rating')
      .in('call_id', callIds);
    if (coachingError) {
      if (!isMissingTableError(coachingError)) console.error('Load coaching events for analytics failed:', coachingError);
      return { ok: false, missingTable: isMissingTableError(coachingError) };
    }
    coachingEvents = ((coachingRows ?? []) as { card_text: string; rep_rating: RepRating | null }[]).map(r => ({
      cardText: r.card_text,
      repRating: r.rep_rating,
    }));
  }

  const { data: versionRows, error: versionsError } = await supabase
    .from('playbook_versions')
    .select('version, created_at')
    .eq('vertical_id', verticalId);
  if (versionsError) {
    if (!isMissingTableError(versionsError)) console.error('Load playbook versions for analytics failed:', versionsError);
    return { ok: false, missingTable: isMissingTableError(versionsError) };
  }
  const playbookVersions = ((versionRows ?? []) as { version: number; created_at: string }[]).map(v => ({
    version: v.version,
    createdAt: v.created_at,
  }));

  // Booked/not_booked totals — scoped to when the transcript entered our
  // system (created_at), not the call's own called_at, which bulk-ingested
  // historical transcripts often leave null. Documented approximation, same
  // spirit as the version-attribution one above.
  const { data: transcriptRows, error: transcriptsError } = await supabase
    .from('transcripts')
    .select('outcome')
    .eq('vertical_id', verticalId)
    .gte('created_at', startIso)
    .lte('created_at', endIso);
  if (transcriptsError) {
    if (!isMissingTableError(transcriptsError)) console.error('Load transcripts for analytics failed:', transcriptsError);
    return { ok: false, missingTable: isMissingTableError(transcriptsError) };
  }
  const transcripts = (transcriptRows ?? []) as StatsTranscriptRow[];

  return { ok: true, inputs: { from, to, calls, followups, coachingEvents, playbookVersions, transcripts } };
}

export type LoadStatsResult = { ok: true; stats: StatsResult } | { ok: false; missingTable: boolean };

export async function loadStats(
  supabase: SupabaseClient,
  params: { verticalId: string; verticalSlug: string; from: string; to: string },
): Promise<LoadStatsResult> {
  const result = await loadStatsInputs(supabase, params);
  if (!result.ok) return result;
  return { ok: true, stats: computeStats(result.inputs) };
}
