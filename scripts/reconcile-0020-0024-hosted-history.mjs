import {
  copyFileSync,
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  buildPasswordlessPostgresUrl,
  buildSanitizedSupabaseCliEnv,
  buildSanitizedPostgresEnv,
  resolveSafeExecPath,
  resolveSupabaseDatabaseTarget,
} from './supabase-db-target.mjs';

const SUPABASE_CLI_ENTRY = fileURLToPath(
  new URL('../node_modules/supabase/dist/supabase.js', import.meta.url),
);
const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const CONFIG_PATH = fileURLToPath(new URL('../supabase/config.toml', import.meta.url));
const CONFIG_SHA256 = '995eb07105469acf5fca9b757fdbde6468f0f113866ed8964417cc04d563345d';
const SUPABASE_CLI_VERSION = '2.112.0';
const PUBLIC_SCHEMA_DUMP_LIMIT = 16 * 1024 * 1024;
const PUBLIC_SCHEMA_RESTRICT_KEY = 'YLL00200024PUBLICSCHEMA';
const PUBLIC_SCHEMA_DUMP_ARGS = Object.freeze([
  '--format=plain',
  '--schema-only',
  '--schema=public',
  '--quote-all-identifiers',
  `--restrict-key=${PUBLIC_SCHEMA_RESTRICT_KEY}`,
  '--no-password',
  '--lock-wait-timeout=5000',
]);
const SUPABASE_PLATFORM_SUFFIXES = Object.freeze({
  'darwin-arm64': ['darwin-arm64'],
  'darwin-x64': ['darwin-x64'],
  'linux-arm64': ['linux-arm64', 'linux-arm64-musl'],
  'linux-x64': ['linux-x64', 'linux-x64-musl'],
  'win32-arm64': ['windows-arm64'],
  'win32-x64': ['windows-x64'],
});
const moduleRequire = createRequire(import.meta.url);

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
const REVIEWED_FUTURE_MIGRATIONS = Object.freeze([
  '0025_quote_tool_identity_bridge.sql',
  '20260821141530_office_tasks.sql',
  '20260825120136_production_quote_tool_identity_activation.sql',
]);
const REVIEWED_MIGRATION_SHA256 = Object.freeze({
  '0001_init.sql':
    'ac52641001a4f3a9451c8653bd79a01fc6b018b65b6194d7454e0f971d518812',
  '0002_playbooks.sql':
    '5225a8d42b3d346a33b5a3a79faa40b8006e353f2cebc185578f77baba787b22',
  '0003_knowledge.sql':
    'b8d49ff8afe0c9ad006ecdff559a81594e0364d794bc65a06fb36c7c4d96b601',
  '0004_calls.sql':
    'd0e0e13013d216f8aa8cdb9f90b1c67c7e783dfd423409f1644166913c7d4268',
  '0005_live.sql':
    '5f564f875482b5c187f1ce7aaddc170da07bf4a3b23adf46266089e7c609d602',
  '0006_brain.sql':
    '31fadb073ebf85991067e02f16a97be26701d8b3a538385d29a5580c937595f3',
  '0007_recordings.sql':
    'd1abffb5ea298ac72ec18dcf36c4492e8b437873d06c09aaa28e35572c45e3b8',
  '0008_scoring.sql':
    'a68266bfb702bcbdb5d07ddb077162e529d3e0aa3d23a60d436a1455211d437e',
  '0009_feedback.sql':
    'e942c420e955cf21a67398a96ea13890b939bc62c6321345b230fd924b9e56fc',
  '0010_digest.sql':
    '505303dde3624007797a1b3f1875518fd0bf6081e77eae23133e7467ee6b6ed3',
  '0011_scoreboard.sql':
    '58d8057e6bcc79783b62d1119271976f7ec0de082a8973192d46d2750334dab1',
  '0012_email.sql':
    '63e58dc8b4fe377ead019af3340d70f9d7209023a7f3ad2067bb4326c9391bbc',
  '0013_second_mile.sql':
    '08057c63a0453178d04be6a6a84e6f123ed387a9def3cb2bfc60100a27a7c4d5',
  '0014_offer.sql':
    'ebf3de3410ed270882df7bc19340c4ff0d75d66ebcd1fabe3a315054380a3310',
  '0015_brain_insights.sql':
    'e060b1fa7fdd4a6cfab7c65d78e830bf0478bfcbd52253cf3fb7022a429a46a3',
  '0016_practice.sql':
    '340c3a4c1cfd1f862b6d44c6bd0ee7fb0129c328f88539e9ff865902abdd65fd',
  '0017_live_dial_grants.sql':
    '3c3b7768ed0f5e88ddc65415e68eb1021134e0437d53d61921fa691cf5f22b53',
  '0018_webhook_idempotency.sql':
    '3faf63e37e3419f64622ac68eb65cf537bf9c73ad2324e5883d4c43182c492ef',
  '0019_existing_tables_default_deny.sql':
    '68b9f645a60bf640b98a1d674d61160d7e6aea3b63857b15c5f72c71a2ea2982',
  '0020_lead_work_authorization.sql':
    '9eeac3229a5b4b4f0e0bcd4b8d557fc8126a62755c3e07e218a8ccd31ae5763c',
  '0021_call_commitments.sql':
    '05b1e7fbb84c9b72673dc02de40c76825252e450f200ceee89fd457786e3aef6',
  '0022_call_commitments_upsert_fn.sql':
    '305ef296696be2305f4327e16120422c663fd1c68e595f7b8e9d8d2c5787f802',
  '0023_operations_hub_identity_foundation.sql':
    'f6b3a3f441b61809ec3aa00b9088922f1ccfe20965479a2a205c615ed50febab',
  '0024_commitment_extraction_tracking.sql':
    '08de9fee454b980693e5c19c51c86ad44985c144637063947062fa61da6e7abf',
  '0025_quote_tool_identity_bridge.sql':
    '8b7b96a1cc81ffd5e71cb051a651d6fe58d1b645673494fbed4f371ae02b6bd9',
  '20260821141530_office_tasks.sql':
    'dc53110c349f4864725531adb9295707a6d5140c037885f1863d58a8be1347a2',
  '20260825120136_production_quote_tool_identity_activation.sql':
    '4c6b638e83ec73b95fb978863cf9bc61ee1e71c08fb489768a687cdd764a6b4e',
});

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

function assertReviewedFutureMigrationManifest(files) {
  if (JSON.stringify(files) !== JSON.stringify(REVIEWED_FUTURE_MIGRATIONS)) {
    throw new Error(
      'Local migrations after 0024 no longer match the reviewed deferred migration set',
    );
  }
}

function assertLocalMigrationManifest(migrationsDirectory = MIGRATIONS_DIR) {
  const sqlEntries = readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter(entry => entry.name.endsWith('.sql'));
  const nonRegularSqlEntries = sqlEntries
    .filter(entry => !entry.isFile())
    .map(entry => entry.name)
    .sort();
  if (nonRegularSqlEntries.length > 0) {
    throw new Error('Every local .sql migration entry must be a regular file');
  }

  const actual = sqlEntries.map(entry => entry.name).sort();
  const canonicalFiles = CANONICAL.map(row => `${row.version}_${row.name}.sql`);
  const expected = [...canonicalFiles, ...REVIEWED_FUTURE_MIGRATIONS].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      'Local migration files no longer match the exact reviewed canonical 0001-0024 and deferred migration set',
    );
  }

  for (const [filename, expectedSha256] of Object.entries(REVIEWED_MIGRATION_SHA256)) {
    const actualSha256 = createHash('sha256')
      .update(readFileSync(join(migrationsDirectory, filename)))
      .digest('hex');
    if (actualSha256 !== expectedSha256) {
      throw new Error(`Reviewed migration ${filename} SHA-256 no longer matches`);
    }
  }

  const canonicalFileSet = new Set(canonicalFiles);
  const futureMigrationFiles = actual.filter(filename => !canonicalFileSet.has(filename));
  assertReviewedFutureMigrationManifest(futureMigrationFiles);
  return futureMigrationFiles;
}

function assertFileSha256(path, expectedSha256, label) {
  const actualSha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (actualSha256 !== expectedSha256) {
    throw new Error(`${label} SHA-256 no longer matches review`);
  }
}

function createMigrationWorkdir(filenames, prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  try {
    const supabaseDirectory = join(directory, 'supabase');
    const migrationsDirectory = join(supabaseDirectory, 'migrations');
    mkdirSync(migrationsDirectory, { recursive: true });
    const copiedConfigPath = join(supabaseDirectory, 'config.toml');
    copyFileSync(CONFIG_PATH, copiedConfigPath);
    assertFileSha256(copiedConfigPath, CONFIG_SHA256, 'Copied Supabase config');
    for (const filename of filenames) {
      const expectedSha256 = REVIEWED_MIGRATION_SHA256[filename];
      if (!expectedSha256) {
        throw new Error(`Migration ${filename} is not part of the reviewed byte manifest`);
      }
      const destination = join(migrationsDirectory, filename);
      copyFileSync(join(MIGRATIONS_DIR, filename), destination);
      assertFileSha256(destination, expectedSha256, `Copied migration ${filename}`);
    }
    return directory;
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function createCanonicalMigrationWorkdir() {
  return createMigrationWorkdir(
    CANONICAL.map(row => `${row.version}_${row.name}.sql`),
    'yll-0020-0024-canonical-',
  );
}

function createReviewedMigrationWorkdir() {
  return createMigrationWorkdir(
    [
      ...CANONICAL.map(row => `${row.version}_${row.name}.sql`),
      ...REVIEWED_FUTURE_MIGRATIONS,
    ],
    'yll-0020-0024-reviewed-',
  );
}

function resolveSupabaseGoBinary(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const suffixes = SUPABASE_PLATFORM_SUFFIXES[`${platform}-${arch}`];
  if (!suffixes) {
    throw new Error('The pinned Supabase shadow helper does not support this platform');
  }
  const resolvePackage = options.resolvePackage ?? (specifier => moduleRequire.resolve(specifier));
  const executable = platform === 'win32' ? 'supabase-go.exe' : 'supabase-go';

  for (const suffix of suffixes) {
    let packageJsonPath;
    try {
      packageJsonPath = resolvePackage(`@supabase/cli-${suffix}/package.json`);
    } catch {
      continue;
    }
    try {
      const metadata = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      const binaryPath = join(dirname(packageJsonPath), 'bin', executable);
      const entry = lstatSync(binaryPath);
      if (
        metadata.version !== SUPABASE_CLI_VERSION
        || !entry.isFile()
        || entry.isSymbolicLink()
        || (platform !== 'win32' && (entry.mode & 0o111) === 0)
      ) {
        throw new Error('invalid pinned Supabase shadow helper');
      }
      return binaryPath;
    } catch {
      throw new Error('The pinned Supabase shadow helper is missing or invalid');
    }
  }
  throw new Error('The pinned Supabase shadow helper package is not installed');
}

function parseShadowProvisionOutput(output) {
  const lines = output.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  if (lines.length !== 3 || lines[2] !== '' || !/^[0-9a-f]{64}$/.test(lines[0])) {
    throw new Error('Canonical shadow helper returned an invalid result');
  }

  let url;
  try {
    url = new URL(lines[1]);
  } catch {
    throw new Error('Canonical shadow helper returned an invalid result');
  }
  if (
    url.protocol !== 'postgresql:'
    || url.username !== 'postgres'
    || url.password !== ''
    || url.hostname !== '127.0.0.1'
    || url.port !== '54320'
    || url.pathname !== '/postgres'
    || url.hash !== ''
    || JSON.stringify([...url.searchParams.entries()])
      !== JSON.stringify([['connect_timeout', '10']])
  ) {
    throw new Error('Canonical shadow helper returned an invalid result');
  }

  return Object.freeze({
    containerId: lines[0],
    postgresEnv: Object.freeze({
      LANG: 'C',
      LC_ALL: 'C',
      PATH: resolveSafeExecPath(),
      PGCONNECT_TIMEOUT: '10',
      PGDATABASE: 'postgres',
      PGHOST: '127.0.0.1',
      PGPASSWORD: 'postgres',
      PGPORT: '54320',
      PGGSSENCMODE: 'disable',
      PGSSLCERTMODE: 'disable',
      PGSSLMODE: 'disable',
      PGUSER: 'postgres',
    }),
  });
}

function normalizePublicSchemaDump(output) {
  if (typeof output !== 'string' || Buffer.byteLength(output, 'utf8') > PUBLIC_SCHEMA_DUMP_LIMIT) {
    throw new Error('Public schema dump is missing or exceeds the reviewed size limit');
  }
  if (output.includes('\0')) {
    throw new Error('Public schema dump is not valid UTF-8 text');
  }

  let sourceVersionCount = 0;
  let clientVersionCount = 0;
  const lines = output.replace(/\r\n/g, '\n').split('\n').map(line => {
    const sourceVersion = line.match(/^-- Dumped from database version (.+)$/)?.[1];
    if (sourceVersion) {
      if (!/^17(?:\.|\s|$)/.test(sourceVersion)) {
        throw new Error('Public schema dump source must be PostgreSQL 17');
      }
      sourceVersionCount += 1;
      return '-- Dumped from database version <normalized>';
    }
    const clientVersion = line.match(/^-- Dumped by pg_dump version (.+)$/)?.[1];
    if (clientVersion) {
      if (!/^17(?:\.|\s|$)/.test(clientVersion)) {
        throw new Error('Public schema dump client must be PostgreSQL 17');
      }
      clientVersionCount += 1;
      return '-- Dumped by pg_dump version <normalized>';
    }
    return line;
  });
  const normalized = lines.join('\n');
  const restrictLine = `\\restrict ${PUBLIC_SCHEMA_RESTRICT_KEY}`;
  const unrestrictLine = `\\unrestrict ${PUBLIC_SCHEMA_RESTRICT_KEY}`;
  if (
    sourceVersionCount !== 1
    || clientVersionCount !== 1
    || lines.filter(line => line === restrictLine).length !== 1
    || lines.filter(line => line === unrestrictLine).length !== 1
    || !normalized.startsWith('--\n-- PostgreSQL database dump\n--\n')
  ) {
    throw new Error('Public schema dump does not match the reviewed PostgreSQL 17 shape');
  }
  return normalized;
}

function assertMatchingPublicSchema(actual, expected) {
  if (actual !== expected) {
    throw new Error('Canonical public schema comparison is not empty; history repair is blocked');
  }
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
  if (/would push|applying migration|pending migration|\b\d+_[^\s]+\.sql\b/i.test(output)) {
    throw new Error('Supabase db push dry-run is not empty');
  }
}

function assertDryRunAgainstFutureMigrations(output, futureMigrationFiles) {
  if (futureMigrationFiles.length === 0) {
    assertEmptyDryRun(output);
    return;
  }

  const mentioned = [...output.matchAll(/\b\d+_[A-Za-z0-9][A-Za-z0-9_-]*\.sql\b/g)]
    .map(match => match[0])
    .sort();
  const expected = [...futureMigrationFiles].sort();
  if (JSON.stringify(mentioned) !== JSON.stringify(expected)) {
    throw new Error('Supabase db push dry-run has unexpected pending migrations beyond 0024');
  }
}

function makeRunner(config, spawn = spawnSync) {
  const defaultWorkdir = createReviewedMigrationWorkdir();
  let supabaseHome = null;
  try {
    supabaseHome = mkdtempSync(join(tmpdir(), 'yll-supabase-cli-home-'));
    chmodSync(supabaseHome, 0o700);
  } catch (error) {
    rmSync(defaultWorkdir, { recursive: true, force: true });
    throw error;
  }
  const run = (command, args, label, env = process.env) => {
    const result = spawn(command, args, {
      encoding: 'utf8',
      env,
      maxBuffer: PUBLIC_SCHEMA_DUMP_LIMIT,
      timeout: 10 * 60 * 1000,
    });
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

  const cliEnv = config.localContainer
    ? {
        LANG: 'C',
        LC_ALL: 'C',
        PATH: resolveSafeExecPath(),
        SUPABASE_HOME: supabaseHome,
        SUPABASE_PROFILE: 'supabase',
      }
    : buildSanitizedSupabaseCliEnv(config.postgresEnv, supabaseHome);

  const shadowEnv = Object.freeze({
    ...(typeof process.env.HOME === 'string' && process.env.HOME.length > 0
      ? { HOME: process.env.HOME }
      : {}),
    LANG: 'C',
    LC_ALL: 'C',
    PATH: resolveSafeExecPath(),
    SUPABASE_HOME: supabaseHome,
    SUPABASE_PROFILE: 'supabase',
  });

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
        '--no-psqlrc',
        '--no-password',
        '--tuples-only',
        '--no-align',
        '--set=ON_ERROR_STOP=on',
        '--command',
        sql,
      ],
      'read-only database verification',
      config.postgresEnv,
    ).stdout;
  };

  const supabaseResult = (args, label, requestedWorkdir = defaultWorkdir) => {
    const targetArgs = config.localContainer
      ? ['--local', '--workdir', requestedWorkdir]
      : ['--db-url', config.passwordlessDbUrl, '--workdir', requestedWorkdir];
    return run(
      process.execPath,
      [SUPABASE_CLI_ENTRY, '--profile', 'supabase', ...args, ...targetArgs, '--yes'],
      label,
      cliEnv,
    );
  };

  const supabase = (args, label, requestedWorkdir = defaultWorkdir) => {
    const result = supabaseResult(args, label, requestedWorkdir);
    return `${result.stdout}\n${result.stderr}`;
  };

  const dumpPublicSchema = (postgresEnv = config.postgresEnv, label = 'public schema dump') => run(
    'pg_dump',
    PUBLIC_SCHEMA_DUMP_ARGS,
    label,
    postgresEnv,
  ).stdout;

  const provisionCanonicalShadow = workdir => {
    const supabaseGoBinary = config.supabaseGoBinary ?? resolveSupabaseGoBinary();
    const version = run(
      supabaseGoBinary,
      ['--version'],
      'pinned Supabase shadow helper version',
      shadowEnv,
    ).stdout.trim();
    if (version !== SUPABASE_CLI_VERSION) {
      throw new Error('Pinned Supabase shadow helper version does not match review');
    }
    const result = run(
      supabaseGoBinary,
      [
        '--profile',
        'supabase',
        'db',
        '__shadow',
        '--mode',
        'diff',
        '--schema',
        'public',
        '--project-ref',
        config.projectRef,
        '--workdir',
        workdir,
        '--yes',
      ],
      'canonical Supabase shadow provisioning',
      shadowEnv,
    );
    try {
      return parseShadowProvisionOutput(result.stdout);
    } catch (error) {
      const candidate = result.stdout.replace(/\r\n/g, '\n').split('\n')[0] ?? '';
      if (/^[0-9a-f]{64}$/.test(candidate)) {
        run(
          'docker',
          ['rm', '-f', '-v', candidate],
          'invalid canonical Supabase shadow cleanup',
          shadowEnv,
        );
      }
      throw error;
    }
  };

  const removeCanonicalShadow = containerId => {
    if (!/^[0-9a-f]{64}$/.test(containerId)) {
      throw new Error('Refusing to remove an invalid canonical shadow container');
    }
    run(
      'docker',
      ['rm', '-f', '-v', containerId],
      'canonical Supabase shadow cleanup',
      shadowEnv,
    );
  };

  const cleanup = () => {
    rmSync(defaultWorkdir, { recursive: true, force: true });
    if (supabaseHome) rmSync(supabaseHome, { recursive: true, force: true });
  };

  return {
    cleanup,
    dumpPublicSchema,
    provisionCanonicalShadow,
    psql,
    removeCanonicalShadow,
    supabase,
    supabaseResult,
  };
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
      and exists (
        select 1
        from public.rubric_versions
        where version = 1
          and source = 'seeded'
          and jsonb_typeof(content) = 'object'
          and content ? 'master'
          and jsonb_typeof(content -> 'sales') = 'array'
          and jsonb_typeof(content -> 'hospitality') = 'array'
      )
      and exists (
        select 1
        from public.coach_settings
        where id = 1
      )
      and exists (
        select 1
        from public.offer_versions
        where version = 1
          and source = 'seeded'
          and jsonb_typeof(content) = 'object'
          and jsonb_typeof(content -> 'elements') = 'array'
      )
    then 'YLL_POST_0024_OK' else 'YLL_POST_0024_MISMATCH' end;
    commit;
  `);
  if (!result.split('\n').includes('YLL_POST_0024_OK')) {
    throw new Error('Post-0024 schema/assertion verification failed');
  }
}

function verifyLocalFullSchemaDiff(runner) {
  // The target state is exactly 0024. Build an isolated Supabase workdir so a
  // reviewed migration that intentionally remains pending after 0024 cannot
  // contaminate this shadow-database comparison.
  const directory = createCanonicalMigrationWorkdir();
  try {
    const result = runner.supabaseResult(
      [
        'db',
        'diff',
        '--schema',
        'public',
        '--use-pg-delta',
      ],
      'canonical public schema diff',
      directory,
    );
    assertEmptySchemaDiff(result.stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function createCanonicalPublicSchemaReference(runner) {
  const directory = createCanonicalMigrationWorkdir();
  let shadow;
  try {
    shadow = runner.provisionCanonicalShadow(directory);
    return normalizePublicSchemaDump(
      runner.dumpPublicSchema(shadow.postgresEnv, 'canonical shadow public schema dump'),
    );
  } finally {
    if (shadow) runner.removeCanonicalShadow(shadow.containerId);
    rmSync(directory, { recursive: true, force: true });
  }
}

function verifyFullSchemaDiff(runner, canonicalPublicSchema) {
  const hostedPublicSchema = normalizePublicSchemaDump(
    runner.dumpPublicSchema(undefined, 'hosted public schema dump'),
  );
  assertMatchingPublicSchema(hostedPublicSchema, canonicalPublicSchema);
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
  const target = resolveSupabaseDatabaseTarget(env);
  const postgresEnv = buildSanitizedPostgresEnv(env, target);
  return {
    localContainer: null,
    passwordlessDbUrl: buildPasswordlessPostgresUrl(target),
    postgresEnv,
    projectRef: target.projectRef,
  };
}

function main() {
  const futureMigrationFiles = assertLocalMigrationManifest();
  const config = parseConfig();
  const runner = makeRunner(config);
  try {
    verifySchemaAndAssertions(runner);
    const canonicalPublicSchema = config.localContainer
      ? null
      : createCanonicalPublicSchemaReference(runner);
    if (canonicalPublicSchema === null) {
      verifyLocalFullSchemaDiff(runner);
    } else {
      verifyFullSchemaDiff(runner, canonicalPublicSchema);
    }
    repairHistory(runner);

    const finalRows = readHistory(runner);
    if (!sameRows(finalRows, CANONICAL)) {
      throw new Error('Canonical 0001-0024 history verification failed');
    }

    verifySchemaAndAssertions(runner);
    if (canonicalPublicSchema === null) {
      verifyLocalFullSchemaDiff(runner);
    } else {
      verifyFullSchemaDiff(runner, canonicalPublicSchema);
    }
    const dryRun = runner.supabase(['db', 'push', '--dry-run'], 'Supabase db push dry-run');
    assertDryRunAgainstFutureMigrations(dryRun, futureMigrationFiles);
    process.stdout.write(
      futureMigrationFiles.length === 0
        ? 'Hosted migration history is canonical and db push dry-run is empty.\n'
        : 'Hosted migration history is canonical; only reviewed migrations after 0024 remain pending.\n',
    );
  } finally {
    runner.cleanup();
  }
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
  CONFIG_SHA256,
  GENERATED,
  REVIEWED_FUTURE_MIGRATIONS,
  REVIEWED_MIGRATION_SHA256,
  MIGRATIONS_DIR,
  PUBLIC_SCHEMA_DUMP_ARGS,
  assertEmptyDryRun,
  assertDryRunAgainstFutureMigrations,
  assertEmptySchemaDiff,
  assertMatchingPublicSchema,
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
  sameRows,
  verifyFullSchemaDiff,
  verifyLocalFullSchemaDiff,
  verifySchemaAndAssertions,
};
