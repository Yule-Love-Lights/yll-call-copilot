// Coverage for isMissingTableError — every route in this app leans on it to
// degrade a missing-migration table into a friendly message instead of a
// hard 500. Regression test for a real bug found live 2026-07-08: PostgREST
// (what @supabase/supabase-js actually talks to) answers a missing table
// with code PGRST205, not Postgres's own 42P01, so the original
// 42P01-only check never matched a real missing-table response.

import { describe, it, expect } from 'vitest';
import { isMissingTableError } from './supabase';

describe('isMissingTableError', () => {
  it('matches PostgREST\'s "not in the schema cache" error (PGRST205)', () => {
    expect(
      isMissingTableError({
        code: 'PGRST205',
        message: "Could not find the table 'public.leads' in the schema cache",
      }),
    ).toBe(true);
  });

  it('matches Postgres\'s own undefined_table error (42P01)', () => {
    expect(isMissingTableError({ code: '42P01', message: 'relation "leads" does not exist' })).toBe(true);
  });

  it('returns false for an unrelated error code', () => {
    expect(isMissingTableError({ code: '23505', message: 'duplicate key value' })).toBe(false);
  });

  it('returns false for a non-object, null, or code-less error', () => {
    expect(isMissingTableError(null)).toBe(false);
    expect(isMissingTableError('nope')).toBe(false);
    expect(isMissingTableError({ message: 'no code here' })).toBe(false);
    expect(isMissingTableError(undefined)).toBe(false);
  });
});
