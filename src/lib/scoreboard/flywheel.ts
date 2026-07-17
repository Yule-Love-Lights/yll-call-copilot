// Wall metric B: the experience flywheel (referral volume + rebook rate +
// new 5-star reviews) — docs/SALES-EXCELLENCE-PLAN.md's "two wall metrics"
// block. Three sub-metrics, each independently wired or honestly
// not-connected; never fake a number for the ones that aren't.

// ─── Phone/email identity matching (pure) ──────────────────────────────────
// Mirrors the AI Quote Tool's own normalizePhone convention
// (src/lib/dashboard/inbox/normalize.ts): best-effort E.164, US-defaulted
// (YLL is Long Island). Returns null rather than guess when the digit count
// doesn't look like a real US number — an unmatched customer is safer than a
// wrong rebook match.
export function normalizePhone(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  if (s.startsWith('+')) {
    const digits = s.slice(1).replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  return v || null;
}

// ─── Rebook rate ────────────────────────────────────────────────────────
// Holiday only (the plan's rebook mechanic is a holiday-season concept — "62
// to 70% of holiday clients rebook when offered early"). Season windows are
// ambiguous in the Quote Tool schema (no season column), so — same fallback
// as quoteToClose's season-to-date — this uses calendar years of
// customer_approved_at.
//
// Identity: normalized PHONE is the primary key. Email is used ONLY when a
// row has no phone at all — no transitive "phone OR email, either match
// unions the rows" behavior. That was tried first and had a real bug: two
// DIFFERENT customers who happen to share one contact field (most commonly
// spouses sharing a household email address — routine for a residential
// lighting company) would fuse into a single identity, distorting both the
// numerator and the denominator of a headline wall metric. Phone is the
// more reliable one-to-one identifier, so it wins whenever present, and a
// shared email never merges two rows that carry different phones.
//
// Accepted trade-off (documented, not a bug): a customer who quoted with a
// phone number one season and only an email address (no phone at all) the
// next season will NOT be counted as a rebook — the two rows key
// differently (`p:...` vs `e:...`) and nothing unions across that
// boundary. That's an honest under-count. A leading KPI should under-claim
// rather than over-claim by merging two different households into one.

export type RebookQuoteRow = {
  phone: string | null;
  email: string | null;
  approvedAt: string; // customer_approved_at, always set (only approved quotes count as "a customer")
  isTest: boolean;
};

// The single identity key for a row: phone when present, else email, else
// null (unmatchable, e.g. neither field parses). No cross-row unioning —
// two rows share an identity only when this returns the same string for
// both, which also means this key is the primary key used to dedupe a
// customer's multiple quotes within one season (see seasonIdentitySet).
function identityKey(row: RebookQuoteRow): string | null {
  const phone = normalizePhone(row.phone);
  if (phone) return `p:${phone}`;
  const email = normalizeEmail(row.email);
  return email ? `e:${email}` : null;
}

function seasonIdentitySet(rows: RebookQuoteRow[], year: number): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.isTest) continue;
    if (new Date(row.approvedAt).getUTCFullYear() !== year) continue;
    const key = identityKey(row);
    // The Set naturally dedupes multiple quotes from the same customer
    // (same primary key) within this one season.
    if (key) keys.add(key);
  }
  return keys;
}

export type RebookRateResult = {
  priorSeasonCustomers: number;
  rebookedCustomers: number;
  rate: number | null; // percent, 1 decimal; null when priorSeasonCustomers === 0
};

export function computeRebookRate(rows: RebookQuoteRow[], asOf: Date): RebookRateResult {
  const thisSeasonYear = asOf.getUTCFullYear();
  const priorSeasonYear = thisSeasonYear - 1;

  const priorSeason = seasonIdentitySet(rows, priorSeasonYear);
  const thisSeason = seasonIdentitySet(rows, thisSeasonYear);

  let rebooked = 0;
  for (const rep of priorSeason) if (thisSeason.has(rep)) rebooked++;

  return {
    priorSeasonCustomers: priorSeason.size,
    rebookedCustomers: rebooked,
    rate: priorSeason.size > 0 ? Math.round((rebooked / priorSeason.size) * 1000) / 10 : null,
  };
}

// ─── Referral volume + new 5-star reviews: honest not-connected ──────────
// Neither is wired today. Every not-connected tile states exactly what
// connection it needs — never a faked number.

// `unit` drives how the board renders a connected value: 'percent' gets a
// '%' suffix, 'count' renders the bare number. Pre-launch audit finding:
// the board used to hardcode a '%' suffix on every connected tile, which
// is correct for rebook rate but wrong the moment referral volume or
// 5-star reviews (both plain counts) get wired up. Required on the
// 'connected' variant so a future caller can't forget it.
export type FlywheelSubMetric =
  | { status: 'connected'; label: string; value: number; unit: 'percent' | 'count'; detail?: string }
  | { status: 'not_connected'; label: string; reason: string };

// Referral volume needs more than the current GHL client offers: contacts
// carry a `tags` array (src/lib/ghl/types.ts), but listContacts() reads only
// ONE page (cap 100, no pagination — see its own doc comment) with no
// created-date filter, so counting "referrals in the last 30 days" off it
// would silently under-report once the contact list passes 100 people.
// Doing this cleanly needs the /contacts/search endpoint (pagination + date
// filtering) plus an agreed tag convention (e.g. every referral-sourced
// contact tagged "referral" at creation) — neither exists yet.
export function referralVolumeMetric(): FlywheelSubMetric {
  return {
    status: 'not_connected',
    label: 'Referral volume',
    reason:
      'Needs a GHL tag convention for referral-sourced contacts, plus the paginated /contacts/search endpoint (today\'s contact list reads one page of 100 with no date filter, so a count off it would silently under-report).',
  };
}

// No reviews API in scope. Google Business Profile (or GHL's reputation
// management add-on) would supply this; neither is connected.
export function newFiveStarReviewsMetric(): FlywheelSubMetric {
  return {
    status: 'not_connected',
    label: 'New 5-star reviews',
    reason: 'Needs a Google Business Profile API connection (or GHL reputation management) — not connected today.',
  };
}

export function rebookRateMetric(rows: RebookQuoteRow[], asOf: Date): FlywheelSubMetric {
  const result = computeRebookRate(rows, asOf);
  if (result.rate === null) {
    return {
      status: 'not_connected',
      label: 'Rebook rate',
      reason: 'No approved holiday quotes from last season to compare against yet.',
    };
  }
  return {
    status: 'connected',
    label: 'Rebook rate',
    value: result.rate,
    unit: 'percent',
    detail: `${result.rebookedCustomers} of ${result.priorSeasonCustomers} prior-season customers`,
  };
}
