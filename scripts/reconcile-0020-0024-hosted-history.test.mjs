import { describe, expect, it } from 'vitest';

import {
  CANONICAL,
  GENERATED,
  assertEmptyDryRun,
  assertEmptySchemaDiff,
  classifyHistory,
  parseConfig,
  parseHistory,
} from './reconcile-0020-0024-hosted-history.mjs';

describe('hosted migration history reconciliation', () => {
  it('recognizes the reviewed start, partial generated revert, and empty resume states', () => {
    expect(classifyHistory(GENERATED).phase).toBe('revert-generated');
    expect(classifyHistory(GENERATED.slice(1)).phase).toBe('revert-generated');
    expect(classifyHistory([]).phase).toBe('empty');
  });

  it('recognizes every canonical applied-repair resume state', () => {
    const partial = CANONICAL.filter(row => !['0007', '0019', '0024'].includes(row.version));
    expect(classifyHistory(partial)).toEqual({
      phase: 'apply-canonical',
      missing: ['0007', '0019', '0024'],
    });
    expect(classifyHistory(CANONICAL).phase).toBe('complete');
  });

  it('rejects mixed, unknown, and wrong-name histories', () => {
    expect(() => classifyHistory([GENERATED[0], CANONICAL[0]])).toThrow(/outside/);
    expect(() => classifyHistory([{ version: '9999', name: 'unknown' }])).toThrow(/outside/);
    expect(() => classifyHistory([{ version: '0001', name: 'wrong' }])).toThrow(/outside/);
  });

  it('parses exact tab-separated version/name rows', () => {
    expect(parseHistory('0001\tinit\n0002\tplaybooks\n')).toEqual(CANONICAL.slice(0, 2));
    expect(parseHistory('')).toEqual([]);
    expect(() => parseHistory('0001 only')).toThrow(/Unexpected/);
  });

  it('requires an empty semantic schema diff', () => {
    expect(() => assertEmptySchemaDiff('\n-- no changes\n/* verified */\n')).not.toThrow();
    expect(() => assertEmptySchemaDiff('alter table public.calls add column unsafe text;')).toThrow(
      /not empty/,
    );
  });

  it('rejects a dry-run that reports any pending migration', () => {
    expect(() => assertEmptyDryRun('Remote database is up to date.')).not.toThrow();
    expect(() => assertEmptyDryRun('Would push these migrations: 0024_example.sql')).toThrow(
      /not empty/,
    );
  });

  it('binds hosted operation to the expected project reference', () => {
    expect(
      parseConfig([], {
        SUPABASE_DB_URL: 'postgresql://postgres.abc123:secret@pooler.example/postgres',
        YLL_EXPECTED_SUPABASE_PROJECT_REF: 'abc123',
      }),
    ).toMatchObject({ localContainer: null });
    expect(() =>
      parseConfig([], {
        SUPABASE_DB_URL: 'postgresql://postgres.wrong:secret@pooler.example/postgres',
        YLL_EXPECTED_SUPABASE_PROJECT_REF: 'abc123',
      }),
    ).toThrow(/does not match/);
  });
});
