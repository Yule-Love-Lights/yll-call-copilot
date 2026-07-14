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
// to 70% of holiday clients rebook when offered early"). A customer is
// identified by normalized phone OR normalized email — either match counts,
// since a returning customer may re-enter their info differently between
// seasons. Season windows are ambiguous in the Quote Tool schema (no season
// column), so — same fallback as quoteToClose's season-to-date — this uses
// calendar years of customer_approved_at.

export type RebookQuoteRow = {
  phone: string | null;
  email: string | null;
  approvedAt: string; // customer_approved_at, always set (only approved quotes count as "a customer")
  isTest: boolean;
};

function identityKeys(row: RebookQuoteRow): string[] {
  const keys: string[] = [];
  const phone = normalizePhone(row.phone);
  const email = normalizeEmail(row.email);
  if (phone) keys.push(`p:${phone}`);
  if (email) keys.push(`e:${email}`);
  return keys;
}

// One customer can carry two identity keys (phone + email); this groups
// keys into an unrolled union so "does this customer appear in season Y" is
// answerable even when the two seasons' quotes used different contact
// fields. Naive union-find over string keys — fine at YLL's data volume.
function seasonIdentitySet(rows: RebookQuoteRow[], year: number): Set<string> {
  // Build a key -> representative map (first key seen for a row becomes the
  // representative every other key on that row aliases to), then collect the
  // set of representatives touched this season.
  const parent = new Map<string, string>();
  function find(k: string): string {
    let root = k;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!;
    return root;
  }
  function union(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  }

  const seasonRepresentatives = new Set<string>();
  for (const row of rows) {
    if (row.isTest) continue;
    const approvedYear = new Date(row.approvedAt).getUTCFullYear();
    const keys = identityKeys(row);
    if (keys.length === 0) continue;
    for (const k of keys) if (!parent.has(k)) parent.set(k, k);
    for (let i = 1; i < keys.length; i++) union(keys[0], keys[i]);
    if (approvedYear === year) {
      for (const k of keys) seasonRepresentatives.add(find(k));
    }
  }
  return seasonRepresentatives;
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

export type FlywheelSubMetric =
  | { status: 'connected'; label: string; value: number; detail?: string }
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
    detail: `${result.rebookedCustomers} of ${result.priorSeasonCustomers} prior-season customers`,
  };
}
