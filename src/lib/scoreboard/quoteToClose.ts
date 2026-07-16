// Wall metric A: quote-to-close %. Pure math over rows already fetched from
// the AI Quote Tool's `quotes` table (src/lib/quoteTool.ts is the read-only
// client; the route does the fetch and hands rows in here, same split as
// src/lib/scoreboard/stats.ts).
//
// Definition, of the quotes SENT in the window, what share were later
// approved (regardless of when the approval landed) — the natural reading
// of "quotes approved / quotes sent" from docs/SALES-EXCELLENCE-PLAN.md's
// "two wall metrics" block. Sent = quote_sent_at IS NOT NULL; approved =
// customer_approved_at IS NOT NULL (approval is the close — what happens
// after, cancellation etc., is a different metric). is_test rows are always
// excluded (ledger #93 in the Quote Tool: fully-simulated data, never real
// pipeline).
//
// Vertical grouping mirrors the Quote Tool's own convention (migrations/
// 2026-06-24-quotes-service-type.sql): a NULL service_type reads as
// 'holiday', the legacy default before the column existed.

export type QuoteToCloseRow = {
  sentAt: string | null;
  approvedAt: string | null;
  vertical: string | null;
  isTest: boolean;
};

export type QuoteToCloseResult = {
  sent: number;
  approved: number;
  rate: number | null; // percent, 1 decimal; null when sent === 0 (never NaN)
};

const DEFAULT_VERTICAL = 'holiday';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function normalizeVertical(vertical: string | null): string {
  return vertical ?? DEFAULT_VERTICAL;
}

function isSentInWindow(row: QuoteToCloseRow, startMs: number, endMs: number): boolean {
  if (row.isTest || !row.sentAt) return false;
  const sentMs = new Date(row.sentAt).getTime();
  return sentMs >= startMs && sentMs <= endMs;
}

export function computeQuoteToClose(rows: QuoteToCloseRow[], window: { startIso: string; endIso: string }): QuoteToCloseResult {
  const startMs = new Date(window.startIso).getTime();
  const endMs = new Date(window.endIso).getTime();
  const sentRows = rows.filter(r => isSentInWindow(r, startMs, endMs));
  const approved = sentRows.filter(r => !!r.approvedAt).length;
  const sent = sentRows.length;
  return { sent, approved, rate: sent > 0 ? round1((approved / sent) * 100) : null };
}

export function computeQuoteToCloseByVertical(
  rows: QuoteToCloseRow[],
  window: { startIso: string; endIso: string },
): Record<string, QuoteToCloseResult> {
  const byVertical = new Map<string, QuoteToCloseRow[]>();
  for (const row of rows) {
    const key = normalizeVertical(row.vertical);
    const bucket = byVertical.get(key) ?? [];
    bucket.push(row);
    byVertical.set(key, bucket);
  }
  const out: Record<string, QuoteToCloseResult> = {};
  for (const [vertical, verticalRows] of byVertical) {
    out[vertical] = computeQuoteToClose(verticalRows, window);
  }
  return out;
}

// Trailing N days ending at `asOf`, inclusive on both ends (asOf is "now").
export function trailingWindow(asOf: Date, days = 30): { startIso: string; endIso: string } {
  const endMs = asOf.getTime();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  return { startIso: new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString() };
}

// Season-to-date. The Quote Tool's schema has no explicit "season" concept
// (confirmed: no season column, no season boundary setting) — deviation,
// same fallback the brief specifies for rebook: calendar-year-to-date, Jan 1
// of asOf's year through asOf.
export function seasonToDateWindow(asOf: Date): { startIso: string; endIso: string } {
  const yearStart = new Date(Date.UTC(asOf.getUTCFullYear(), 0, 1));
  return { startIso: yearStart.toISOString(), endIso: asOf.toISOString() };
}

export type QuoteToCloseSummary = {
  trailing30: { overall: QuoteToCloseResult; byVertical: Record<string, QuoteToCloseResult> };
  seasonToDate: { overall: QuoteToCloseResult; byVertical: Record<string, QuoteToCloseResult> };
};

export function buildQuoteToCloseSummary(rows: QuoteToCloseRow[], asOf: Date): QuoteToCloseSummary {
  const trailing = trailingWindow(asOf, 30);
  const season = seasonToDateWindow(asOf);
  return {
    trailing30: { overall: computeQuoteToClose(rows, trailing), byVertical: computeQuoteToCloseByVertical(rows, trailing) },
    seasonToDate: { overall: computeQuoteToClose(rows, season), byVertical: computeQuoteToCloseByVertical(rows, season) },
  };
}
