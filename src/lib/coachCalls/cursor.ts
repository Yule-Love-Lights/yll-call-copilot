// Cursor helpers for paging GET /api/coach/calls newest-first. Ordering
// purely on scored_at (call_scores.scored_at) is unsafe once two or more
// rows share the exact same timestamp -- batch scoring (the nightly
// recording sync scores a whole night's backlog back to back) can write
// near-identical scored_at values, and a plain `.lt(scored_at, cursor)`
// filter silently drops every row after the first one at that timestamp
// once it falls on a page boundary. The fix orders by (scored_at desc, id
// desc) and carries both fields in the cursor, so ties break on id instead
// of vanishing.
//
// Cursor shape is "scoredAt~id" (id a uuid, scoredAt an ISO timestamp).
// "~" is a safe separator: neither field ever contains it, unlike "-"
// which both an ISO date and a uuid already use. A bare timestamp with no
// "~" (the pre-fix cursor shape, e.g. an already-open browser tab) is
// still accepted and parses to {scoredAt, id: null}.

const SEPARATOR = '~';

export type ParsedCursor = { scoredAt: string; id: string | null };

export function buildCursor(scoredAt: string, id: string): string {
  return `${scoredAt}${SEPARATOR}${id}`;
}

export function parseCursor(raw: string): ParsedCursor {
  const idx = raw.lastIndexOf(SEPARATOR);
  if (idx === -1) return { scoredAt: raw, id: null };
  return { scoredAt: raw.slice(0, idx), id: raw.slice(idx + 1) };
}

// Builds the supabase-js `.or()` filter string for "strictly before this
// cursor" under (scored_at desc, id desc) ordering: either an earlier
// scored_at, or the same scored_at with a smaller id. A legacy
// timestamp-only cursor (id: null) falls back to the old bare
// scored_at.lt filter, same behavior the route had before this fix.
export function buildBeforeFilter(cursor: ParsedCursor): string {
  if (cursor.id === null) {
    return `scored_at.lt.${cursor.scoredAt}`;
  }
  return `scored_at.lt.${cursor.scoredAt},and(scored_at.eq.${cursor.scoredAt},id.lt.${cursor.id})`;
}
