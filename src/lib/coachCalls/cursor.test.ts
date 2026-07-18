// Coverage for the (scored_at, id) paging cursor used by GET
// /api/coach/calls -- see cursor.ts's module comment for why a bare
// scored_at cursor is unsafe (ties on scored_at get silently skipped
// across a page boundary once batch scoring writes near-identical
// timestamps).

import { describe, it, expect } from 'vitest';
import { buildCursor, parseCursor, buildBeforeFilter } from './cursor';

describe('buildCursor / parseCursor', () => {
  it('round-trips a scoredAt + id pair', () => {
    const cursor = buildCursor('2026-07-10T12:05:00.000Z', 'a1b2c3d4-0000-0000-0000-000000000001');
    expect(cursor).toBe('2026-07-10T12:05:00.000Z~a1b2c3d4-0000-0000-0000-000000000001');
    expect(parseCursor(cursor)).toEqual({
      scoredAt: '2026-07-10T12:05:00.000Z',
      id: 'a1b2c3d4-0000-0000-0000-000000000001',
    });
  });

  it('parses a bare timestamp cursor (pre-fix / already-open clients) with a null id', () => {
    expect(parseCursor('2026-07-10T12:05:00.000Z')).toEqual({
      scoredAt: '2026-07-10T12:05:00.000Z',
      id: null,
    });
  });
});

describe('buildBeforeFilter', () => {
  it('builds an earlier-OR-tied-with-smaller-id filter for a full cursor', () => {
    const filter = buildBeforeFilter({ scoredAt: '2026-07-10T12:05:00.000Z', id: 'row-1' });
    expect(filter).toBe('scored_at.lt.2026-07-10T12:05:00.000Z,and(scored_at.eq.2026-07-10T12:05:00.000Z,id.lt.row-1)');
  });

  it('falls back to a bare scored_at.lt filter for a legacy timestamp-only cursor', () => {
    const filter = buildBeforeFilter({ scoredAt: '2026-07-10T12:05:00.000Z', id: null });
    expect(filter).toBe('scored_at.lt.2026-07-10T12:05:00.000Z');
  });
});
