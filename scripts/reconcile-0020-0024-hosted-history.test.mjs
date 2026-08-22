import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CANONICAL,
  CONFIG_SHA256,
  GENERATED,
  MIGRATIONS_DIR,
  PUBLIC_SCHEMA_DUMP_ARGS,
  REVIEWED_FUTURE_MIGRATIONS,
  REVIEWED_MIGRATION_SHA256,
  assertDryRunAgainstFutureMigrations,
  assertEmptyDryRun,
  assertEmptySchemaDiff,
  assertLocalMigrationManifest,
  assertReviewedFutureMigrationManifest,
  classifyHistory,
  createCanonicalPublicSchemaReference,
  createCanonicalMigrationWorkdir,
  createReviewedMigrationWorkdir,
  makeRunner,
  normalizePublicSchemaDump,
  parseConfig,
  parseHistory,
  parseShadowProvisionOutput,
  resolveSupabaseGoBinary,
  verifyFullSchemaDiff,
  verifyLocalFullSchemaDiff,
  verifySchemaAndAssertions,
} from './reconcile-0020-0024-hosted-history.mjs';

const sslDirectory = mkdtempSync(join(tmpdir(), 'yll-history-ca-test-'));
chmodSync(sslDirectory, 0o700);
const sslRootCertificatePath = join(sslDirectory, 'supabase-ca.crt');
const sslRootCertificate =
  '-----BEGIN CERTIFICATE-----\nTEST-SUPABASE-CA\n-----END CERTIFICATE-----\n';
writeFileSync(sslRootCertificatePath, sslRootCertificate, { mode: 0o600 });
const sslRootCertificateSha256 = createHash('sha256')
  .update(sslRootCertificate)
  .digest('hex');
afterAll(() => rmSync(sslDirectory, { recursive: true, force: true }));

function sslEnvironment() {
  return {
    YLL_EXPECTED_SUPABASE_SSL_ROOT_CERT_SHA256: sslRootCertificateSha256,
    YLL_SUPABASE_SSL_ROOT_CERT: sslRootCertificatePath,
  };
}

function publicSchemaDump(version, body = 'CREATE TABLE "public"."calls" ();') {
  return `--
-- PostgreSQL database dump
--

\\restrict YLL00200024PUBLICSCHEMA

-- Dumped from database version ${version}
-- Dumped by pg_dump version 17.9

${body}

\\unrestrict YLL00200024PUBLICSCHEMA
`;
}

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

  it('keeps pg-delta limited to local rehearsals and reads its SQL from stdout', () => {
    expect(() => verifyLocalFullSchemaDiff({
      supabaseResult: () => ({
        stdout: 'alter table public.calls add column unsafe text;\n',
        stderr: 'Creating shadow database...\n',
      }),
    })).toThrow(/not empty/);
    expect(() => verifyLocalFullSchemaDiff({
      supabaseResult: () => ({ stdout: '', stderr: 'No changes detected\n' }),
    })).not.toThrow();
  });

  it('compares full public schema dumps while normalizing only version banners', () => {
    const canonical = normalizePublicSchemaDump(publicSchemaDump('17.6'));
    expect(normalizePublicSchemaDump(publicSchemaDump('17.11'))).toBe(canonical);
    expect(() => verifyFullSchemaDiff({
      dumpPublicSchema: () => publicSchemaDump('17.11'),
    }, canonical)).not.toThrow();
    expect(() => verifyFullSchemaDiff({
      dumpPublicSchema: () => publicSchemaDump(
        '17.11',
        'ALTER TABLE "public"."calls" ADD COLUMN "unsafe" text;',
      ),
    }, canonical)).toThrow(/not empty/);

    for (const unsafe of [
      '',
      publicSchemaDump('17.11').replace('\\restrict ', '\\restrict wrong'),
      publicSchemaDump('17.11').replace('-- Dumped by pg_dump version 17.9\n', ''),
      publicSchemaDump('16.9'),
      publicSchemaDump('17.11').replace(
        '-- Dumped by pg_dump version 17.9',
        '-- Dumped by pg_dump version 18.1',
      ),
    ]) {
      expect(() => normalizePublicSchemaDump(unsafe)).toThrow();
    }
  });

  it('requires the data-bearing canonical seed effects before and after history repair', () => {
    let query = '';
    expect(() => verifySchemaAndAssertions({
      psql: sql => {
        query = sql;
        return 'YLL_POST_0024_OK\n';
      },
    })).not.toThrow();
    expect(query).toContain('from public.rubric_versions');
    expect(query).toContain("source = 'seeded'");
    expect(query).toContain('from public.coach_settings');
    expect(query).toContain('from public.offer_versions');
    expect(() => verifySchemaAndAssertions({ psql: () => 'YLL_POST_0024_MISMATCH\n' }))
      .toThrow(/schema\/assertion/);
  });

  it('validates the passwordless loopback shadow result exactly', () => {
    const containerId = 'a'.repeat(64);
    const parsed = parseShadowProvisionOutput(
      `${containerId}\npostgresql://postgres@127.0.0.1:54320/postgres?connect_timeout=10\n\n`,
    );
    expect(parsed.containerId).toBe(containerId);
    expect(parsed.postgresEnv).toMatchObject({
      PGHOST: '127.0.0.1',
      PGPASSWORD: 'postgres',
      PGPORT: '54320',
      PGSSLMODE: 'disable',
    });
    for (const unsafe of [
      `not-an-id\npostgresql://postgres@127.0.0.1:54320/postgres?connect_timeout=10\n\n`,
      `${containerId}\npostgresql://postgres:secret@127.0.0.1:54320/postgres?connect_timeout=10\n\n`,
      `${containerId}\npostgresql://postgres@db.example.test:54320/postgres?connect_timeout=10\n\n`,
      `${containerId}\npostgresql://postgres@127.0.0.1:54320/postgres?sslmode=disable\n\n`,
      `${containerId}\npostgresql://postgres@127.0.0.1:54320/postgres?connect_timeout=10\nextra\n`,
    ]) {
      expect(() => parseShadowProvisionOutput(unsafe)).toThrow(/invalid result/);
    }
  });

  it('resolves the executable sidecar from the exact pinned platform package', () => {
    expect(resolveSupabaseGoBinary()).toMatch(/supabase-go(?:\.exe)?$/);
    expect(() => resolveSupabaseGoBinary({ platform: 'unsupported', arch: 'none' })).toThrow(
      /does not support/,
    );
  });

  it('rejects a dry-run that reports any pending migration', () => {
    expect(() => assertEmptyDryRun('Remote database is up to date.')).not.toThrow();
    expect(() => assertEmptyDryRun('Would push these migrations: 0024_example.sql')).toThrow(
      /not empty/,
    );
    expect(() => assertEmptyDryRun('20260822083000_unreviewed.sql')).toThrow(/not empty/);
  });

  it('permits only the reviewed post-0024 migration files while reconciling older history', () => {
    expect(() => assertDryRunAgainstFutureMigrations(
      'Would push these migrations:\n0025_quote_tool_identity_bridge.sql\n20260821141530_office_tasks.sql',
      REVIEWED_FUTURE_MIGRATIONS,
    )).not.toThrow();
    expect(() => assertDryRunAgainstFutureMigrations(
      'Would push these migrations: 0025_quote_tool_identity_bridge.sql',
      REVIEWED_FUTURE_MIGRATIONS,
    )).toThrow(/unexpected pending/);
    expect(() => assertDryRunAgainstFutureMigrations(
      'Would push these migrations: 20260822083000_unreviewed.sql',
      REVIEWED_FUTURE_MIGRATIONS,
    )).toThrow(/unexpected pending/);
  });

  it('requires the exact reviewed SQL manifest and rejects unreviewed timestamp migrations', () => {
    expect(assertLocalMigrationManifest()).toEqual(REVIEWED_FUTURE_MIGRATIONS);

    const directory = mkdtempSync(join(tmpdir(), 'yll-migration-manifest-'));
    try {
      const expected = [
        ...CANONICAL.map(row => `${row.version}_${row.name}.sql`),
        ...REVIEWED_FUTURE_MIGRATIONS,
      ];
      for (const filename of expected) {
        copyFileSync(join(MIGRATIONS_DIR, filename), join(directory, filename));
      }

      expect(assertLocalMigrationManifest(directory)).toEqual(REVIEWED_FUTURE_MIGRATIONS);

      const unreviewed = join(directory, '20260822083000_unreviewed.sql');
      writeFileSync(unreviewed, '');
      expect(() => assertLocalMigrationManifest(directory)).toThrow(/exact reviewed/);
      rmSync(unreviewed);

      writeFileSync(join(directory, REVIEWED_FUTURE_MIGRATIONS[0]), '-- changed\n');
      expect(() => assertLocalMigrationManifest(directory)).toThrow(/SHA-256/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects symlink and other non-regular SQL directory entries', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yll-migration-entry-types-'));
    try {
      const target = join(directory, 'target.txt');
      writeFileSync(target, '');
      symlinkSync(target, join(directory, '20260822083000_symlink.sql'));
      expect(() => assertLocalMigrationManifest(directory)).toThrow(/regular file/);
      rmSync(join(directory, '20260822083000_symlink.sql'));

      mkdirSync(join(directory, '20260822083000_directory.sql'));
      expect(() => assertLocalMigrationManifest(directory)).toThrow(/regular file/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails closed when the local deferred migration set changes', () => {
    expect(() => assertReviewedFutureMigrationManifest(REVIEWED_FUTURE_MIGRATIONS)).not.toThrow();
    expect(() => assertReviewedFutureMigrationManifest([])).toThrow(/deferred migration set/);
    expect(() => assertReviewedFutureMigrationManifest([
      '0025_quote_tool_identity_bridge.sql',
      '0026_unreviewed.sql',
    ])).toThrow(/deferred migration set/);
  });

  it('builds the schema-diff shadow project from exactly canonical 0001 through 0024', () => {
    const directory = createCanonicalMigrationWorkdir();
    try {
      const files = readdirSync(join(directory, 'supabase', 'migrations')).sort();
      expect(files).toEqual(CANONICAL.map(row => `${row.version}_${row.name}.sql`));
      expect(createHash('sha256')
        .update(readFileSync(join(directory, 'supabase', 'config.toml')))
        .digest('hex')).toBe(CONFIG_SHA256);
      for (const filename of files) {
        expect(createHash('sha256')
          .update(readFileSync(join(directory, 'supabase', 'migrations', filename)))
          .digest('hex')).toBe(REVIEWED_MIGRATION_SHA256[filename]);
      }
      for (const migration of REVIEWED_FUTURE_MIGRATIONS) {
        expect(files).not.toContain(migration);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('builds the repair workdir from canonical 0001-0024 and the exact deferred set', () => {
    const directory = createReviewedMigrationWorkdir();
    try {
      const files = readdirSync(join(directory, 'supabase', 'migrations')).sort();
      expect(files).toEqual([
        ...CANONICAL.map(row => `${row.version}_${row.name}.sql`),
        ...REVIEWED_FUTURE_MIGRATIONS,
      ].sort());
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('binds hosted operation to the expected project reference', () => {
    const expectedRef = 'mjmociuxxxwxvasnpxav';
    expect(
      parseConfig([], {
        ...sslEnvironment(),
        YLL_MIGRATION_ENVIRONMENT: 'production',
        SUPABASE_DB_URL:
          'postgresql://postgres.mjmociuxxxwxvasnpxav:secret@aws-0-us-east-2.pooler.supabase.com:5432/postgres',
        YLL_EXPECTED_SUPABASE_PROJECT_REF: expectedRef,
      }),
    ).toMatchObject({ localContainer: null });
    expect(
      parseConfig([], {
        ...sslEnvironment(),
        YLL_MIGRATION_ENVIRONMENT: 'production',
        SUPABASE_DB_URL:
          'postgresql://postgres:secret@db.mjmociuxxxwxvasnpxav.supabase.co:5432/postgres',
        YLL_EXPECTED_SUPABASE_PROJECT_REF: expectedRef,
      }),
    ).toMatchObject({ localContainer: null });
    expect(() =>
      parseConfig([], {
        ...sslEnvironment(),
        YLL_MIGRATION_ENVIRONMENT: 'production',
        SUPABASE_DB_URL:
          'postgresql://postgres.ewbtkrytrnerypdkuimd:secret@aws-0-us-east-2.pooler.supabase.com:5432/postgres',
        YLL_EXPECTED_SUPABASE_PROJECT_REF: expectedRef,
      }),
    ).toThrow(/host and user do not match/);
    expect(() =>
      parseConfig([], {
        ...sslEnvironment(),
        YLL_MIGRATION_ENVIRONMENT: 'production',
        SUPABASE_DB_URL:
          'postgresql://postgres.mjmociuxxxwxvasnpxav:secret@pooler.attacker.invalid:5432/postgres',
        YLL_EXPECTED_SUPABASE_PROJECT_REF: expectedRef,
      }),
    ).toThrow(/host and user do not match/);
    expect(() =>
      parseConfig([], {
        ...sslEnvironment(),
        YLL_MIGRATION_ENVIRONMENT: 'production',
        SUPABASE_DB_URL:
          'postgresql://postgres:secret@db.mjmociuxxxwxvasnpxav.supabase.co.attacker.invalid:5432/postgres',
        YLL_EXPECTED_SUPABASE_PROJECT_REF: expectedRef,
      }),
    ).toThrow(/host and user do not match/);
    expect(() =>
      parseConfig([], {
        ...sslEnvironment(),
        YLL_MIGRATION_ENVIRONMENT: 'production',
        SUPABASE_DB_URL:
          'postgresql://postgres.mjmociuxxxwxvasnpxav:secret@aws-0-us-east-2.pooler.supabase.com:5432/postgres',
        YLL_EXPECTED_SUPABASE_PROJECT_REF: 'ewbtkrytrnerypdkuimd',
      }),
    ).toThrow(/frozen migration environment/);
    expect(() =>
      parseConfig([], {
        ...sslEnvironment(),
        YLL_MIGRATION_ENVIRONMENT: 'production',
        SUPABASE_DB_URL:
          'https://postgres:secret@db.mjmociuxxxwxvasnpxav.supabase.co:5432/postgres',
        YLL_EXPECTED_SUPABASE_PROJECT_REF: expectedRef,
      }),
    ).toThrow(/postgres or postgresql protocol/);
    expect(() =>
      parseConfig([], {
        ...sslEnvironment(),
        YLL_MIGRATION_ENVIRONMENT: 'production',
        SUPABASE_DB_URL:
          'postgresql://postgres:secret@db.mjmociuxxxwxvasnpxav.supabase.co:5432/template1',
        YLL_EXPECTED_SUPABASE_PROJECT_REF: expectedRef,
      }),
    ).toThrow(/postgres database/);
  });

  it('uses a passwordless exact db-url and environment password without linking or exposing secrets', () => {
    const secret = 'never-put-this-in-argv';
    const rawUrl =
      `postgresql://postgres.mjmociuxxxwxvasnpxav:${secret}`
      + '@aws-0-us-east-2.pooler.supabase.com:5432/postgres';
    const config = parseConfig([], {
      ...sslEnvironment(),
      NODE_OPTIONS: '--require attacker.js',
      NPM_CONFIG_REGISTRY: 'https://attacker.invalid',
      SUPABASE_API_URL: 'https://attacker.invalid',
      SUPABASE_HOME: '/tmp/attacker-supabase-home',
      SUPABASE_PROFILE: '/tmp/attacker-profile.json',
      SUPABASE_DB_URL: rawUrl,
      SUPABASE_PROJECT_HOST: 'attacker.invalid',
      YLL_EXPECTED_SUPABASE_PROJECT_REF: 'mjmociuxxxwxvasnpxav',
      YLL_MIGRATION_ENVIRONMENT: 'production',
    });
    const calls = [];
    let isolatedHomeMode;
    const spawn = (command, args, options) => {
      calls.push({ command, args, options });
      if (command === process.execPath) {
        isolatedHomeMode = statSync(options.env.SUPABASE_HOME).mode & 0o777;
      }
      return { status: 0, stdout: '', stderr: '' };
    };
    const runner = makeRunner(config, spawn);
    try {
      runner.psql('select 1');
      runner.supabase(['db', 'push', '--dry-run'], 'dry run');
    } finally {
      runner.cleanup();
    }

    expect(calls.map(call => call.command)).toEqual(['psql', process.execPath]);
    for (const call of calls) {
      expect(call.args.join(' ')).not.toContain(secret);
      expect(call.args.join(' ')).not.toContain(rawUrl);
      expect(call.options.env).not.toHaveProperty('SUPABASE_DB_URL');
      expect(call.options.env).not.toHaveProperty('NODE_OPTIONS');
      expect(call.options.env).not.toHaveProperty('NPM_CONFIG_REGISTRY');
      expect(call.options.env).not.toHaveProperty('SUPABASE_API_URL');
      expect(call.options.env).not.toHaveProperty('SUPABASE_PROJECT_HOST');
    }
    expect(calls[0].options.env.PGPASSWORD).toBe(secret);
    expect(calls[0].options.env.PGSSLMODE).toBe('verify-full');
    expect(calls[0].options.env.PGSSLROOTCERT).toBe(sslRootCertificatePath);
    expect(calls[1].args).not.toContain('--linked');
    expect(calls[1].args).not.toContain('link');
    expect(calls[1].args).toContain('--db-url');
    const cliUrl = calls[1].args[calls[1].args.indexOf('--db-url') + 1];
    expect(cliUrl).toContain('mjmociuxxxwxvasnpxav');
    expect(cliUrl).toContain('sslmode=verify-full');
    expect(cliUrl).toContain('sslrootcert=');
    expect(new URL(cliUrl).password).toBe('');
    expect(calls[1].options.env.PGPASSWORD).toBe(secret);
    expect(calls[1].options.env.PGSSLMODE).toBe('verify-full');
    expect(calls[1].options.env.PGSSLROOTCERT).toBe(sslRootCertificatePath);
    expect(calls[1].options.env.SUPABASE_PROFILE).toBe('supabase');
    expect(calls[1].options.env.SUPABASE_HOME).not.toBe('/tmp/attacker-supabase-home');
    expect(calls[1].args).toContain('--profile');
    expect(calls[1].args[calls[1].args.indexOf('--profile') + 1]).toBe('supabase');
    expect(isolatedHomeMode).toBe(0o700);
    expect(existsSync(calls[1].options.env.SUPABASE_HOME)).toBe(false);
  });

  it('provisions one exact canonical shadow, compares with PG17 pg_dump, and removes it', () => {
    const containerId = 'b'.repeat(64);
    const config = {
      ...parseConfig([], {
        ...sslEnvironment(),
        SUPABASE_DB_URL:
          'postgresql://postgres:secret@db.mjmociuxxxwxvasnpxav.supabase.co:5432/postgres',
        YLL_EXPECTED_SUPABASE_PROJECT_REF: 'mjmociuxxxwxvasnpxav',
        YLL_MIGRATION_ENVIRONMENT: 'production',
      }),
      supabaseGoBinary: '/pinned/supabase-go',
    };
    const calls = [];
    const spawn = (command, args, options) => {
      calls.push({ command, args, options });
      if (command === '/pinned/supabase-go') {
        if (args.length === 1 && args[0] === '--version') {
          return { status: 0, stdout: '2.112.0\n', stderr: '' };
        }
        return {
          status: 0,
          stdout:
            `${containerId}\n`
            + 'postgresql://postgres@127.0.0.1:54320/postgres?connect_timeout=10\n\n',
          stderr: '',
        };
      }
      if (command === 'pg_dump') {
        return { status: 0, stdout: publicSchemaDump('17.6'), stderr: '' };
      }
      if (command === 'docker') return { status: 0, stdout: '', stderr: '' };
      throw new Error(`unexpected command: ${command}`);
    };
    const runner = makeRunner(config, spawn);
    try {
      expect(createCanonicalPublicSchemaReference(runner)).toBe(
        normalizePublicSchemaDump(publicSchemaDump('17.11')),
      );
    } finally {
      runner.cleanup();
    }

    expect(calls.map(call => call.command)).toEqual([
      '/pinned/supabase-go',
      '/pinned/supabase-go',
      'pg_dump',
      'docker',
    ]);
    expect(calls[0].args).toEqual(['--version']);
    expect(calls[1].args).toEqual(expect.arrayContaining([
      'db',
      '__shadow',
      '--mode',
      'diff',
      '--schema',
      'public',
      '--project-ref',
      'mjmociuxxxwxvasnpxav',
    ]));
    expect(calls[0].options.env).not.toHaveProperty('PGPASSWORD');
    expect(calls[0].options.env).not.toHaveProperty('SUPABASE_DB_URL');
    expect(calls[0].options.env).not.toHaveProperty('SUPABASE_ACCESS_TOKEN');
    expect(calls[1].options.env).not.toHaveProperty('PGPASSWORD');
    expect(calls[2].args).toEqual(PUBLIC_SCHEMA_DUMP_ARGS);
    expect(calls[2].options.env).toMatchObject({
      PGHOST: '127.0.0.1',
      PGPASSWORD: 'postgres',
      PGSSLMODE: 'disable',
    });
    expect(calls[3].args).toEqual(['rm', '-f', '-v', containerId]);
  });

  it('isolates the Supabase profile for local-container rehearsals too', () => {
    const calls = [];
    let isolatedHome;
    const runner = makeRunner({ localContainer: 'rehearsal-db' }, (command, args, options) => {
      calls.push({ command, args, options });
      isolatedHome = options.env.SUPABASE_HOME;
      expect(statSync(isolatedHome).mode & 0o777).toBe(0o700);
      return { status: 0, stdout: '', stderr: '' };
    });
    try {
      runner.supabase(['db', 'push', '--dry-run'], 'local dry run');
    } finally {
      runner.cleanup();
    }

    expect(calls).toHaveLength(1);
    expect(calls[0].options.env.SUPABASE_PROFILE).toBe('supabase');
    expect(calls[0].args).toContain('--profile');
    expect(calls[0].args).toContain('--local');
    expect(existsSync(isolatedHome)).toBe(false);
  });
});
