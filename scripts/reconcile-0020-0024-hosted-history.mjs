import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SUPABASE_VERSION = '2.112.0';
const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const PROJECT_REF = /^[a-z0-9]{20}$/;

const GENERATED = Object.freeze([
  { version: '20260819235532', name: '0017_live_dial_grants' },
  { version: '20260820001714', name: '0018_webhook_idempotency' },
]);

const CANONICAL = Object.freeze([
  ['0001', 'init'],
  ['0002', 'playbooks'],
  ['0003', 'knowledge'],
  ['0004', 'calls'],
  ['0005', 'live'],
  ['0006', 'brain'],
  ['0007', 'recordings'],
  ['0008', 'scoring'],
  ['0009', 'feedback'],
  ['0010', 'digest'],
  ['0011', 'scoreboard'],
  ['0012', 'email'],
  ['0013', 'second_mile'],
  ['0014', 'offer'],
  ['0015', 'brain_insights'],
  ['0016', 'practice'],
  ['0017', 'live_dial_grants'],
  ['0018', 'webhook_idempotency'],
  ['0019', 'existing_tables_default_deny'],
  ['0020', 'lead_work_authorization'],
  ['0021', 'call_commitments'],
  ['0022', 'call_commitments_upsert_fn'],
  ['0023', 'operations_hub_identity_foundation'],
  ['0024', 'commitment_extraction_tracking'],
].map(([version, name]) => Object.freeze({ version, name })));

const CANONICAL_BY_VERSION = new Map(CANONICAL.map(row => [row.version, row]));
const GENERATED_BY_VERSION = new Map(GENERATED.map(row => [row.version, row]));

function sameRows(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((row, index) =>
      row.version === expected[index].version && row.name === expected[index].name,
    )
  );
}

function classifyHistory(rows) {
  if (sameRows(rows, CANONICAL)) return { phase: 'complete', missing: [] };

  if (rows.every(row => GENERATED_BY_VERSION.get(row.version)?.name === row.name)) {
    return { phase: rows.length === 0 ? 'empty' : 'revert-generated', missing: [] };
  }

  if (rows.every(row => CANONICAL_BY_VERSION.get(row.version)?.name === row.name)) {
    const present = new Set(rows.map(row => row.version));
    return {
      phase: 'apply-canonical',
      missing: CANONICAL.filter(row => !present.has(row.version)).map(row => row.version),
    };
  }

  throw new Error(
    `Migration history is outside the reviewed start/resume states: ${JSON.stringify(rows)}`,
  );
}

function parseHistory(output) {
  if (!output.trim()) return [];
  return output
    .trim()
    .split('\n')
    .map(line => {
      const [version, name, extra] = line.split('\t');
      if (!version || !name || extra !== undefined) {
        throw new Error(`Unexpected migration-history row: ${line}`);
      }
      return { version, name };
    });
}

function assertLocalMigrationManifest() {
  const actual = readdirSync(MIGRATIONS_DIR)
    .filter(name => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  const expected = CANONICAL.map(row => `${row.version}_${row.name}.sql`);
  const canonicalFiles = actual.filter(name =>
    CANONICAL_BY_VERSION.has(name.slice(0, 4)),
  );
  const unreviewedPastOrCurrent = actual.filter(name =>
    Number(name.slice(0, 4)) <= 24 && !CANONICAL_BY_VERSION.has(name.slice(0, 4)),
  );
  if (
    JSON.stringify(canonicalFiles) !== JSON.stringify(expected)
    || unreviewedPastOrCurrent.length > 0
  ) {
    throw new Error('Local migration files no longer match the reviewed canonical 0001-0024 set');
  }
  return actual.filter(name => Number(name.slice(0, 4)) > 24);
}

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*--.*$/gm, '')
    .trim();
}

function assertEmptySchemaDiff(sql) {
  if (stripSqlComments(sql)) {
    throw new Error('Canonical public schema diff is not empty; migration history repair is blocked');
  }
}

function assertEmptyDryRun(output) {
  if (/would push|applying migration|pending migration|\b\d{4}_[^\s]+\.sql\b/i.test(output)) {
    throw new Error('Supabase db push dry-run is not empty');
  }
}

function assertDryRunAgainstFutureMigrations(output, futureMigrationFiles) {
  if (futureMigrationFiles.length === 0) {
    assertEmptyDryRun(output);
    return;
  }

  const mentioned = [...output.matchAll(/\b\d{4}_[A-Za-z0-9][A-Za-z0-9_-]*\.sql\b/g)]
    .map(match => match[0])
    .sort();
  const expected = [...futureMigrationFiles].sort();
  if (JSON.stringify(mentioned) !== JSON.stringify(expected)) {
    throw new Error('Supabase db push dry-run has unexpected pending migrations beyond 0024');
  }
}

function makeRunner(config) {
  const run = (command, args, label) => {
    const result = spawnSync(command, args, { encoding: 'utf8', env: process.env });
    if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
    if (result.status !== 0) {
      if (config.localContainer) {
        const detail = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
        throw new Error(`${label} failed with exit ${result.status}${detail ? `: ${detail}` : ''}`);
      }
      throw new Error(`${label} failed with exit ${result.status}; hosted output is suppressed`);
    }
    return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };

  const psql = sql => {
    if (config.localContainer) {
      return run(
        'docker',
        [
          'exec',
          '-i',
          config.localContainer,
          'psql',
          '--username',
          'postgres',
          '--dbname',
          'postgres',
          '--tuples-only',
          '--no-align',
          '--set',
          'ON_ERROR_STOP=on',
          '--command',
          sql,
        ],
        'read-only database verification',
      ).stdout;
    }
    return run(
      'psql',
      [
        config.dbUrl,
        '-X',
        '--tuples-only',
        '--no-align',
        '--set',
        'ON_ERROR_STOP=on',
        '--command',
        sql,
      ],
      'read-only database verification',
    ).stdout;
  };

  const targetArgs = config.localContainer ? ['--local'] : ['--db-url', config.dbUrl];
  const supabase = (args, label) => {
    const result = run(
      'npx',
      ['--yes', `supabase@${SUPABASE_VERSION}`, ...args, ...targetArgs, '--yes'],
      label,
    );
    return `${result.stdout}\n${result.stderr}`;
  };

  return { psql, supabase };
}

function readHistory(runner) {
  return parseHistory(
    runner.psql(`
      select version || chr(9) || coalesce(name, '<null>')
      from supabase_migrations.schema_migrations
      order by version
    `),
  );
}

function verifySchemaAndAssertions(runner) {
  const result = runner.psql(`
    begin transaction read only;
    select public.assert_legacy_metric_artifacts_reconciled();
    select public.assert_personal_touch_metric_provenance();
    select case when
      current_user = 'postgres'
      and exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'transcripts'
          and column_name = 'metric_scope'
      )
      and to_regclass('public.call_commitments') is not null
      and to_regprocedure('public.call_commitments_upsert_batch(uuid,jsonb)') is not null
      and (
        select count(*) = 5
        from information_schema.tables
        where table_schema = 'public'
          and table_name in (
            'ops_departments',
            'ops_employees',
            'ops_employee_auth_identities',
            'ops_employee_department_memberships',
            'ops_identity_audit_events'
          )
      )
      and to_regprocedure(
        'public.advance_recording_sync_cursor(timestamp with time zone,jsonb)'
      ) is not null
    then 'YLL_POST_0024_OK' else 'YLL_POST_0024_MISMATCH' end;
    commit;
  `);
  if (!result.split('\n').includes('YLL_POST_0024_OK')) {
    throw new Error('Post-0024 schema/assertion verification failed');
  }
}

function verifyFullSchemaDiff(runner) {
  const directory = mkdtempSync(join(tmpdir(), 'yll-0020-0024-schema-diff-'));
  const output = join(directory, 'public-schema.sql');
  try {
    runner.supabase(
      ['db', 'diff', '--schema', 'public', '--use-pg-delta', '--output', output],
      'canonical public schema diff',
    );
    assertEmptySchemaDiff(existsSync(output) ? readFileSync(output, 'utf8') : '');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function repairHistory(runner) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const rows = readHistory(runner);
    const state = classifyHistory(rows);
    if (state.phase === 'complete') return;

    if (state.phase === 'revert-generated') {
      runner.supabase(
        [
          'migration',
          'repair',
          ...rows.map(row => row.version),
          '--status',
          'reverted',
        ],
        'generated-version revert repair',
      );
      continue;
    }

    const missing = state.phase === 'empty' ? CANONICAL.map(row => row.version) : state.missing;
    runner.supabase(
      ['migration', 'repair', ...missing, '--status', 'applied'],
      'canonical-version applied repair',
    );
  }
  throw new Error('Migration history did not converge after five repair transitions');
}

function parseConfig(argv = process.argv.slice(2), env = process.env) {
  if (argv.length === 2 && argv[0] === '--local-container' && argv[1]) {
    return { localContainer: argv[1], dbUrl: null };
  }
  if (argv.length !== 0) {
    throw new Error('Usage: node scripts/reconcile-0020-0024-hosted-history.mjs [--local-container NAME]');
  }
  const dbUrl = env.SUPABASE_DB_URL;
  const expectedRef = env.YLL_EXPECTED_SUPABASE_PROJECT_REF;
  if (!dbUrl || !expectedRef) {
    throw new Error('SUPABASE_DB_URL and YLL_EXPECTED_SUPABASE_PROJECT_REF are required');
  }
  if (!PROJECT_REF.test(expectedRef)) {
    throw new Error('YLL_EXPECTED_SUPABASE_PROJECT_REF is not a canonical hosted project reference');
  }
  const parsed = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.pathname !== '/postgres') {
    throw new Error('SUPABASE_DB_URL is not a canonical hosted Postgres connection URL');
  }
  const hostname = parsed.hostname.toLowerCase();
  const username = decodeURIComponent(parsed.username);
  const isDirectConnection =
    hostname === `db.${expectedRef}.supabase.co` && username === 'postgres';
  const isPoolerConnection =
    /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(hostname) &&
    username === `postgres.${expectedRef}`;
  if (!isDirectConnection && !isPoolerConnection) {
    throw new Error('SUPABASE_DB_URL does not match YLL_EXPECTED_SUPABASE_PROJECT_REF');
  }
  return { localContainer: null, dbUrl };
}

function main() {
  const futureMigrationFiles = assertLocalMigrationManifest();
  const config = parseConfig();
  const runner = makeRunner(config);

  verifySchemaAndAssertions(runner);
  verifyFullSchemaDiff(runner);
  repairHistory(runner);

  const finalRows = readHistory(runner);
  if (!sameRows(finalRows, CANONICAL)) throw new Error('Canonical 0001-0024 history verification failed');

  verifySchemaAndAssertions(runner);
  verifyFullSchemaDiff(runner);
  const dryRun = runner.supabase(['db', 'push', '--dry-run'], 'Supabase db push dry-run');
  assertDryRunAgainstFutureMigrations(dryRun, futureMigrationFiles);
  process.stdout.write(
    futureMigrationFiles.length === 0
      ? 'Hosted migration history is canonical and db push dry-run is empty.\n'
      : 'Hosted migration history is canonical; only reviewed migrations after 0024 remain pending.\n',
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export {
  CANONICAL,
  GENERATED,
  assertEmptyDryRun,
  assertDryRunAgainstFutureMigrations,
  assertEmptySchemaDiff,
  classifyHistory,
  parseConfig,
  parseHistory,
  sameRows,
};
