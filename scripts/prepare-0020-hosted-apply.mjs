// Builds the one-transaction hosted driver for canonical migrations 0020-0024.
//
// The reviewed six-class historical reconciliation and canonical 0020-0024
// run in one transaction. Canonical migration bytes remain unchanged, and
// migration history remains a separate official Supabase CLI repair.
//
// Usage:
//   node scripts/prepare-0020-hosted-apply.mjs \
//     --manifest /protected/reviewed-artifacts.csv \
//     --identity-manifest /protected/reviewed-identity-backfill.csv \
//     --output /protected/0020-0024-hosted.sql

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = Object.freeze([
  ['0020', '0020_lead_work_authorization.sql'],
  ['0021', '0021_call_commitments.sql'],
  ['0022', '0022_call_commitments_upsert_fn.sql'],
  ['0023', '0023_operations_hub_identity_foundation.sql'],
  ['0024', '0024_commitment_extraction_tracking.sql'],
]);
const EXPECTED_MIGRATION_SHA256 = Object.freeze({
  '0020': '9eeac3229a5b4b4f0e0bcd4b8d557fc8126a62755c3e07e218a8ccd31ae5763c',
  '0021': '05b1e7fbb84c9b72673dc02de40c76825252e450f200ceee89fd457786e3aef6',
  '0022': '305ef296696be2305f4327e16120422c663fd1c68e595f7b8e9d8d2c5787f802',
  '0023': 'f6b3a3f441b61809ec3aa00b9088922f1ccfe20965479a2a205c615ed50febab',
  '0024': '08de9fee454b980693e5c19c51c86ad44985c144637063947062fa61da6e7abf',
});
const EXPECTED_PREAMBLE_SHA256 =
  'fb14729202d4fd5df44af365a899a3bd7b8a9a31b5402db536394d8e5573bc24';

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const PREAMBLE_PATH = fileURLToPath(
  new URL('./sql/0020_historical_reconciliation_preamble.sql', import.meta.url),
);
const MANIFEST_HEADER = 'artifact_class,id';
const IDENTITY_MANIFEST_HEADER =
  'employee_id,normalized_email_hex,legacy_role,backfilled_role,legacy_created_at_epoch,auth_user_id';
const ARTIFACT_CLASSES = new Set([
  'weekly_digest',
  'brain_review',
  'playbook_proposal',
  'edited_playbook_version',
  'unsafe_personal_touch',
  'orphan_call_score',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function loadMigrations() {
  return MIGRATIONS.map(([version, filename]) => ({
    version,
    filename,
    sql: readFileSync(new URL(`../supabase/migrations/${filename}`, import.meta.url), 'utf8'),
  }));
}

function parseManifest(text) {
  if (!text.endsWith('\n') || text.endsWith('\n\n')) {
    throw new Error('manifest must end with exactly one newline');
  }
  if (text.includes('\r')) throw new Error('manifest carriage returns are not allowed');
  const lines = text.slice(0, -1).split('\n');
  if (lines[0] !== MANIFEST_HEADER) throw new Error(`manifest header must be ${MANIFEST_HEADER}`);
  const rows = [];
  const seen = new Set();
  for (const [index, line] of lines.slice(1).entries()) {
    if (!line) throw new Error(`manifest contains a blank row at line ${index + 2}`);
    if (line.includes('"')) throw new Error(`manifest quotes are not allowed at line ${index + 2}`);
    const columns = line.split(',');
    if (columns.length !== 2) throw new Error(`manifest row must have two columns at line ${index + 2}`);
    const [artifactClass, id] = columns;
    if (!ARTIFACT_CLASSES.has(artifactClass)) {
      throw new Error(`manifest artifact class is not allowed at line ${index + 2}`);
    }
    if (!UUID.test(id)) throw new Error(`manifest UUID is not canonical at line ${index + 2}`);
    const key = `${artifactClass},${id}`;
    if (seen.has(key)) throw new Error(`manifest contains a duplicate row at line ${index + 2}`);
    seen.add(key);
    rows.push({ artifactClass, id, key });
  }
  const sorted = [...rows].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (rows.some((row, index) => row.key !== sorted[index].key)) {
    throw new Error('manifest rows must be sorted by artifact_class,id');
  }
  return rows;
}

function parseIdentityManifest(text) {
  if (!text.endsWith('\n') || text.endsWith('\n\n')) {
    throw new Error('identity manifest must end with exactly one newline');
  }
  if (text.includes('\r')) {
    throw new Error('identity manifest carriage returns are not allowed');
  }
  const lines = text.slice(0, -1).split('\n');
  if (lines[0] !== IDENTITY_MANIFEST_HEADER) {
    throw new Error(`identity manifest header must be ${IDENTITY_MANIFEST_HEADER}`);
  }

  const rows = [];
  const employeeIds = new Set();
  const authUserIds = new Set();
  for (const [index, line] of lines.slice(1).entries()) {
    const lineNumber = index + 2;
    if (!line) throw new Error(`identity manifest contains a blank row at line ${lineNumber}`);
    if (line.includes('"')) {
      throw new Error(`identity manifest quotes are not allowed at line ${lineNumber}`);
    }
    const columns = line.split(',');
    if (columns.length !== 6) {
      throw new Error(`identity manifest row must have six columns at line ${lineNumber}`);
    }
    const [
      employeeId,
      normalizedEmailHex,
      legacyRole,
      backfilledRole,
      legacyCreatedAtEpoch,
      authUserId,
    ] = columns;
    if (!UUID.test(employeeId) || !UUID.test(authUserId)) {
      throw new Error(`identity manifest UUID is not canonical at line ${lineNumber}`);
    }
    if (!/^(?:[0-9a-f]{2})+$/.test(normalizedEmailHex)) {
      throw new Error(`identity manifest email hex is not canonical at line ${lineNumber}`);
    }
    const emailBytes = Buffer.from(normalizedEmailHex, 'hex');
    const normalizedEmail = emailBytes.toString('utf8');
    if (
      !Buffer.from(normalizedEmail, 'utf8').equals(emailBytes) ||
      normalizedEmail !== normalizedEmail.trim().toLowerCase() ||
      !normalizedEmail.includes('@') ||
      /[\0\r\n]/.test(normalizedEmail)
    ) {
      throw new Error(`identity manifest normalized email is invalid at line ${lineNumber}`);
    }
    if (!['rep', 'office', 'owner', 'admin'].includes(legacyRole)) {
      throw new Error(`identity manifest legacy role is not allowed at line ${lineNumber}`);
    }
    const expectedBackfilledRole = legacyRole === 'rep' ? 'office' : legacyRole;
    if (backfilledRole !== expectedBackfilledRole) {
      throw new Error(`identity manifest backfilled role is invalid at line ${lineNumber}`);
    }
    if (legacyCreatedAtEpoch && !/^[0-9]+(?:\.[0-9]+)?$/.test(legacyCreatedAtEpoch)) {
      throw new Error(`identity manifest created-at epoch is invalid at line ${lineNumber}`);
    }
    if (employeeIds.has(employeeId)) {
      throw new Error(`identity manifest contains a duplicate employee at line ${lineNumber}`);
    }
    if (authUserIds.has(authUserId)) {
      throw new Error(`identity manifest contains a duplicate Auth user at line ${lineNumber}`);
    }
    employeeIds.add(employeeId);
    authUserIds.add(authUserId);
    rows.push({
      employeeId,
      authUserId,
      key: `${employeeId},${authUserId}`,
    });
  }

  const sorted = [...rows].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (rows.some((row, index) => row.key !== sorted[index].key)) {
    throw new Error('identity manifest rows must be sorted by employee_id,auth_user_id');
  }
  return rows;
}

function build(
  entries,
  manifestText,
  identityManifestText,
  preamble = readFileSync(PREAMBLE_PATH, 'utf8'),
) {
  if (entries.length !== MIGRATIONS.length) {
    throw new Error(`expected ${MIGRATIONS.length} migrations, received ${entries.length}`);
  }

  const sections = entries.map((entry, index) => {
    const [expectedVersion, expectedFilename] = MIGRATIONS[index];
    if (entry.version !== expectedVersion || entry.filename !== expectedFilename) {
      throw new Error(
        `migration order mismatch at ${index}: expected ${expectedVersion}/${expectedFilename}`,
      );
    }
    if (!entry.sql.trim()) throw new Error(`migration ${entry.version} is empty`);
    if (!entry.sql.endsWith('\n')) {
      throw new Error(`migration ${entry.version} must end with a newline for exact-byte embedding`);
    }
    if (/^\s*(?:begin|start\s+transaction|commit|rollback)\s*;/im.test(entry.sql)) {
      throw new Error(`migration ${entry.version} contains transaction control`);
    }
    return (
      `-- BEGIN canonical migration ${entry.version}: ${entry.filename}\n` +
      entry.sql +
      `-- END canonical migration ${entry.version}: ${entry.filename}`
    );
  });

  const migration0020 = entries[0].sql;
  for (const required of [
    'do $legacy_metric_artifact_preflight$',
    'do $legacy_personal_touch_provenance_preflight$',
    'create function public.assert_legacy_metric_artifacts_reconciled()',
  ]) {
    if (!migration0020.includes(required)) {
      throw new Error(`canonical 0020 guard is absent: ${required}`);
    }
  }

  for (const entry of entries) {
    const actual = createHash('sha256').update(entry.sql).digest('hex');
    if (actual !== EXPECTED_MIGRATION_SHA256[entry.version]) {
      throw new Error(`canonical migration ${entry.version} SHA-256 no longer matches review`);
    }
  }

  parseManifest(manifestText);
  parseIdentityManifest(identityManifestText);
  const artifactMarker = '__REVIEWED_ARTIFACT_MANIFEST__';
  const identityMarker = '__REVIEWED_IDENTITY_BACKFILL__';
  if (preamble.split(artifactMarker).length !== 2) {
    throw new Error('reconciliation artifact marker mismatch');
  }
  if (preamble.split(identityMarker).length !== 2) {
    throw new Error('reconciliation identity marker mismatch');
  }
  if (/^\s*(?:begin|start\s+transaction|commit|rollback)\s*;/im.test(preamble)) {
    throw new Error('reconciliation preamble contains transaction control');
  }
  const preambleDigest = createHash('sha256').update(preamble).digest('hex');
  if (preambleDigest !== EXPECTED_PREAMBLE_SHA256) {
    throw new Error('reconciliation preamble SHA-256 no longer matches review');
  }
  const manifestRows = manifestText.slice(MANIFEST_HEADER.length + 1, -1);
  const identityManifestRows = identityManifestText.slice(
    IDENTITY_MANIFEST_HEADER.length + 1,
    -1,
  );
  const renderedPreamble = preamble
    .replace(identityMarker, `${IDENTITY_MANIFEST_HEADER}\n${identityManifestRows}`.trimEnd())
    .replace(artifactMarker, `${MANIFEST_HEADER}\n${manifestRows}`.trimEnd());

  return `\\set ON_ERROR_STOP on
-- Generated by scripts/prepare-0020-hosted-apply.mjs.
-- Reviewed historical reconciliation and canonical migrations are atomic.
-- Migration history is intentionally unchanged by this transaction.
begin;

${renderedPreamble.trimEnd()}

${sections.join('\n\n')}

do $hosted_0020_0024_verify$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transcripts'
      and column_name = 'metric_scope'
  )
    or to_regclass('public.call_commitments') is null
    or to_regprocedure('public.call_commitments_upsert_batch(uuid,jsonb)') is null
    or (
      select count(*)
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (
          'ops_departments',
          'ops_employees',
          'ops_employee_auth_identities',
          'ops_employee_department_memberships',
          'ops_identity_audit_events'
        )
    ) <> 5
    or to_regprocedure(
      'public.advance_recording_sync_cursor(timestamp with time zone,jsonb)'
    ) is null
  then
    raise exception 'Hosted 0020-0024 bundle postcondition failed';
  end if;

  perform public.assert_legacy_metric_artifacts_reconciled();
  perform public.assert_personal_touch_metric_provenance();
end
$hosted_0020_0024_verify$;

commit;
`;
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function buildDashboard(entries, manifestText, identityManifestText, preamble) {
  const psqlDriver = build(entries, manifestText, identityManifestText, preamble);
  const identityRows = parseIdentityManifest(identityManifestText);
  const artifactRows = parseManifest(manifestText);

  const identityCopy =
    `copy reviewed_identity_backfill (\n` +
    `  employee_id,\n` +
    `  normalized_email_hex,\n` +
    `  legacy_role,\n` +
    `  backfilled_role,\n` +
    `  legacy_created_at_epoch,\n` +
    `  auth_user_id\n` +
    `)\nfrom stdin with (format csv, header true);\n` +
    identityManifestText +
    `\\.\n`;
  const identityInsert = identityRows.length === 0
    ? 'insert into reviewed_identity_backfill (employee_id, normalized_email_hex, legacy_role, backfilled_role, legacy_created_at_epoch, auth_user_id) select null, null, null, null, null, null where false;\n'
    : `insert into reviewed_identity_backfill (employee_id, normalized_email_hex, legacy_role, backfilled_role, legacy_created_at_epoch, auth_user_id) values\n` +
      identityManifestText.slice(IDENTITY_MANIFEST_HEADER.length + 1, -1)
        .split('\n')
        .map(row => row.split(',').map(sqlLiteral).join(', '))
        .map(row => `  (${row})`)
        .join(',\n') +
      ';\n';

  const artifactCopy =
    `copy reviewed_metric_artifacts (artifact_class, id)\n` +
    `from stdin with (format csv, header true);\n` +
    manifestText +
    `\\.\n`;
  const artifactInsert = artifactRows.length === 0
    ? 'insert into reviewed_metric_artifacts (artifact_class, id) select null, null where false;\n'
    : `insert into reviewed_metric_artifacts (artifact_class, id) values\n` +
      artifactRows.map(row => `  (${sqlLiteral(row.artifactClass)}, ${sqlLiteral(row.id)})`).join(',\n') +
      ';\n';

  const dashboardDriver = psqlDriver
    .replace(/^\\\\set ON_ERROR_STOP on\n/, '')
    .replace(identityCopy, identityInsert)
    .replace(artifactCopy, artifactInsert);
  if (dashboardDriver === psqlDriver || dashboardDriver.includes('from stdin')) {
    throw new Error('failed to render dashboard-compatible reviewed manifests');
  }
  return dashboardDriver;
}

function assertSha256(value, label) {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} must be a lowercase SHA-256`);
}

function buildDashboardDigestBound(entries, {
  identityCount,
  identityDigest,
  artifactDigest,
  artifactCounts,
}, preamble) {
  if (!Number.isSafeInteger(identityCount) || identityCount < 0) {
    throw new Error('identity count must be a non-negative safe integer');
  }
  assertSha256(identityDigest, 'identity digest');
  assertSha256(artifactDigest, 'artifact digest');
  const expectedClasses = [...ARTIFACT_CLASSES].sort();
  if (
    !artifactCounts ||
    JSON.stringify(Object.keys(artifactCounts).sort()) !== JSON.stringify(expectedClasses) ||
    expectedClasses.some(key => !Number.isSafeInteger(artifactCounts[key]) || artifactCounts[key] < 0)
  ) {
    throw new Error('artifact counts must contain each allowed class with a non-negative safe integer');
  }

  const psqlDriver = build(
    entries,
    `${MANIFEST_HEADER}\n`,
    `${IDENTITY_MANIFEST_HEADER}\n`,
    preamble,
  );
  const emptyIdentityCopy =
    `copy reviewed_identity_backfill (\n  employee_id,\n  normalized_email_hex,\n  legacy_role,\n  backfilled_role,\n  legacy_created_at_epoch,\n  auth_user_id\n)\nfrom stdin with (format csv, header true);\n${IDENTITY_MANIFEST_HEADER}\n\\.\n`;
  const emptyArtifactCopy =
    `copy reviewed_metric_artifacts (artifact_class, id)\nfrom stdin with (format csv, header true);\n${MANIFEST_HEADER}\n\\.\n`;
  const identityBinding = `insert into reviewed_identity_backfill\nselect * from current_identity_backfill;\n\ndo $dashboard_identity_digest_guard$\nbegin\n  if (select count(*) from reviewed_identity_backfill) <> ${identityCount}\n    or (\n      select encode(digest(coalesce(string_agg(concat_ws('|', employee_id::text, normalized_email_hex, legacy_role, backfilled_role, legacy_created_at_epoch, auth_user_id::text), E'\\n' order by employee_id, auth_user_id), ''), 'sha256'), 'hex')\n      from reviewed_identity_backfill\n    ) <> '${identityDigest}'\n  then\n    raise exception 'Dashboard identity mapping digest mismatch';\n  end if;\nend\n$dashboard_identity_digest_guard$;\n\n`;
  const artifactBinding = `insert into reviewed_metric_artifacts\nselect * from current_metric_artifacts;\n\ndo $dashboard_artifact_digest_guard$\nbegin\n  if (select count(*) from reviewed_metric_artifacts) <> ${expectedClasses.reduce((sum, key) => sum + artifactCounts[key], 0)}\n    or (\n      select encode(digest(coalesce(string_agg(artifact_class || '|' || id::text, E'\\n' order by artifact_class, id), ''), 'sha256'), 'hex')\n      from reviewed_metric_artifacts\n    ) <> '${artifactDigest}'\n    or ${expectedClasses.map(key => `(select count(*) from reviewed_metric_artifacts where artifact_class = '${key}') <> ${artifactCounts[key]}`).join('\n    or ')}\n  then\n    raise exception 'Dashboard artifact manifest digest or count mismatch';\n  end if;\nend\n$dashboard_artifact_digest_guard$;\n\n`;
  const identityMarker = '\n\ndo $reviewed_identity_guard$';
  const artifactMarker = '\n\ndo $reviewed_manifest_guard$';
  const dashboardDriver = psqlDriver
    .replace(/^\\\\set ON_ERROR_STOP on\n/, '')
    .replace(emptyIdentityCopy, '')
    .replace(emptyArtifactCopy, '')
    .replace(identityMarker, `\n\n${identityBinding}do $reviewed_identity_guard$`)
    .replace(artifactMarker, `\n\n${artifactBinding}do $reviewed_manifest_guard$`);
  if (dashboardDriver.includes('from stdin') || dashboardDriver.includes('\\\\.\n')) {
    throw new Error('failed to render dashboard digest-bound driver');
  }
  return dashboardDriver;
}

function extractEmbeddedManifest(driverText, tableName, header) {
  const copyMarker = `copy ${tableName} (`;
  const copyAt = driverText.indexOf(copyMarker);
  if (copyAt === -1 || driverText.lastIndexOf(copyMarker) !== copyAt) {
    throw new Error(`generated driver ${tableName} COPY block is missing or duplicated`);
  }
  const headerMarker = `${header}\n`;
  const headerAt = driverText.indexOf(headerMarker, copyAt);
  if (headerAt === -1) {
    throw new Error(`generated driver ${tableName} manifest header is missing`);
  }
  const terminatorAt = driverText.indexOf('\n\\.\n', headerAt);
  if (terminatorAt === -1) {
    throw new Error(`generated driver ${tableName} COPY terminator is missing`);
  }
  return driverText.slice(headerAt, terminatorAt + 1);
}

function assertGeneratedHostedDriver(sql) {
  const bytes = Buffer.isBuffer(sql) ? sql : Buffer.from(sql);
  const driverText = bytes.toString('utf8');
  if (!Buffer.from(driverText, 'utf8').equals(bytes)) {
    throw new Error('apply input is not a valid UTF-8 generated driver');
  }
  const identityManifest = extractEmbeddedManifest(
    driverText,
    'reviewed_identity_backfill',
    IDENTITY_MANIFEST_HEADER,
  );
  const artifactManifest = extractEmbeddedManifest(
    driverText,
    'reviewed_metric_artifacts',
    MANIFEST_HEADER,
  );
  const expected = build(loadMigrations(), artifactManifest, identityManifest);
  if (!Buffer.from(expected, 'utf8').equals(bytes)) {
    throw new Error('apply input is not the exact generated 0020-0024 hosted driver');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args[0] === '--dashboard-digest-bound') {
    const option = flag => args[args.indexOf(flag) + 1];
    const output = option('--output');
    const artifactCountsText = option('--artifact-counts-json');
    if (
      args.length !== 11 || !output || !artifactCountsText ||
      !option('--identity-count') || !option('--identity-sha256') || !option('--artifact-sha256')
    ) {
      throw new Error('Usage: prepare-0020-hosted-apply.mjs --dashboard-digest-bound --identity-count N --identity-sha256 SHA256 --artifact-sha256 SHA256 --artifact-counts-json JSON --output FILE');
    }
    const out = buildDashboardDigestBound(loadMigrations(), {
      identityCount: Number(option('--identity-count')),
      identityDigest: option('--identity-sha256'),
      artifactDigest: option('--artifact-sha256'),
      artifactCounts: JSON.parse(artifactCountsText),
    });
    writeFileSync(output, out, { flag: 'wx', mode: 0o600 });
    process.stderr.write(`wrote ${output} (driver SHA-256 ${createHash('sha256').update(out).digest('hex')})\n`);
    process.exit(0);
  }
  if (
    (args.length !== 6 && args.length !== 8) ||
    args[0] !== '--manifest' ||
    !args[1] ||
    args[2] !== '--identity-manifest' ||
    !args[3] ||
    args[4] !== '--output' ||
    !args[5]
  ) {
    throw new Error(
      'Usage: prepare-0020-hosted-apply.mjs --manifest FILE --identity-manifest FILE --output FILE [--format psql|dashboard]',
    );
  }
  const manifest = readFileSync(args[1], 'utf8');
  const identityManifest = readFileSync(args[3], 'utf8');
  const entries = loadMigrations();
  const format = args.length === 8 ? args[7] : 'psql';
  if (args.length === 8 && args[6] !== '--format') {
    throw new Error('optional format must use --format psql|dashboard');
  }
  if (!['psql', 'dashboard'].includes(format)) {
    throw new Error('format must be psql or dashboard');
  }
  const out = format === 'dashboard'
    ? buildDashboard(entries, manifest, identityManifest)
    : build(entries, manifest, identityManifest);
  writeFileSync(args[5], out, { flag: 'wx', mode: 0o600 });
  const manifestDigest = createHash('sha256').update(manifest).digest('hex');
  const identityManifestDigest = createHash('sha256').update(identityManifest).digest('hex');
  const driverDigest = createHash('sha256').update(out).digest('hex');
  process.stderr.write(
    `wrote ${args[5]} (artifact manifest SHA-256 ${manifestDigest}; ` +
      `identity manifest SHA-256 ${identityManifestDigest}; driver SHA-256 ${driverDigest})\n`,
  );
}

export {
  ARTIFACT_CLASSES,
  EXPECTED_MIGRATION_SHA256,
  EXPECTED_PREAMBLE_SHA256,
  IDENTITY_MANIFEST_HEADER,
  MANIFEST_HEADER,
  MIGRATIONS,
  MIGRATIONS_DIR,
  assertGeneratedHostedDriver,
  build,
  buildDashboard,
  buildDashboardDigestBound,
  loadMigrations,
  parseManifest,
  parseIdentityManifest,
};
