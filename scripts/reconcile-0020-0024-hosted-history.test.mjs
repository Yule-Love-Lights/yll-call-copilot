import { describe, expect, it } from 'vitest';

import {
  CANONICAL,
  GENERATED,
  assertDryRunAgainstFutureMigrations,
  assertEmptyDryRun,
  assertLocalMigrationManifest,
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

  it('permits only the reviewed post-0024 migration files while reconciling older history', () => {
    expect(() => assertDryRunAgainstFutureMigrations(
      [
        'Would push these migrations:',
        '0025_quote_tool_identity_bridge.sql',
        '20260821141530_office_tasks.sql',
      ].join('\n'),
      ['0025_quote_tool_identity_bridge.sql', '20260821141530_office_tasks.sql'],
    )).not.toThrow();
    expect(() => assertDryRunAgainstFutureMigrations(
      'Would push these migrations: 0026_unreviewed.sql',
      ['0025_quote_tool_identity_bridge.sql'],
    )).toThrow(/unexpected pending/);
  });

  it('includes timestamped reviewed migrations in the local post-0024 manifest', () => {
    expect(assertLocalMigrationManifest()).toEqual([
      '0025_quote_tool_identity_bridge.sql',
      '20260821141530_office_tasks.sql',
    ]);
  });

  it('binds hosted operation to the expected project reference', () => {
    const expectedRef = 'abcdefghijklmnopqrst';
    expect(
      parseConfig([], {
        SUPABASE_DB_URL:
          'postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-us-east-2.pooler.supabase.com/postgres',
        YLL_EXPECTED_SUPABASE_PROJECT_REF: expectedRef,
      }),
    ).toMatchObject({ localContainer: null });
    expect(
      parseConfig([], {
        SUPABASE_DB_URL:
          'postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co/postgres',
        YLL_EXPECTED_SUPABASE_PROJECT_REF: expectedRef,
      }),
    ).toMatchObject({ localContainer: null });
    expect(() =>
      parseConfig([], {
        SUPABASE_DB_URL:
          'postgresql://postgres.wrongabcdefghijklmnopqrst:secret@aws-0-us-east-2.pooler.supabase.com/postgres',
        YLL_EXPECTED_SUPABASE_PROJECT_REF: expectedRef,
      }),
    ).toThrow(/does not match/);
    expect(() =>
      parseConfig([], {
        SUPABASE_DB_URL:
          'postgresql://postgres.abcdefghijklmnopqrst:secret@pooler.attacker.invalid/postgres',
        YLL_EXPECTED_SUPABASE_PROJECT_REF: expectedRef,
      }),
    ).toThrow(/does not match/);
    expect(() =>
      parseConfig([], {
        SUPABASE_DB_URL:
          'postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co.attacker.invalid/postgres',
        YLL_EXPECTED_SUPABASE_PROJECT_REF: expectedRef,
      }),
    ).toThrow(/does not match/);
    expect(() =>
      parseConfig([], {
        SUPABASE_DB_URL:
          'postgresql://postgres.short:secret@aws-0-us-east-2.pooler.supabase.com/postgres',
        YLL_EXPECTED_SUPABASE_PROJECT_REF: 'short',
      }),
    ).toThrow(/canonical hosted project reference/);
    expect(() =>
      parseConfig([], {
        SUPABASE_DB_URL:
          'https://postgres:secret@db.abcdefghijklmnopqrst.supabase.co/postgres',
        YLL_EXPECTED_SUPABASE_PROJECT_REF: expectedRef,
      }),
    ).toThrow(/canonical hosted Postgres connection URL/);
    expect(() =>
      parseConfig([], {
        SUPABASE_DB_URL:
          'postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co/template1',
        YLL_EXPECTED_SUPABASE_PROJECT_REF: expectedRef,
      }),
    ).toThrow(/canonical hosted Postgres connection URL/);
  });
});
