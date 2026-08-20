// Builds the one-transaction hosted driver for canonical migrations 0020-0024.
//
// The reviewed six-class historical reconciliation and canonical 0020-0024
// run in one transaction. Canonical migration bytes remain unchanged, and
// migration history remains a separate official Supabase CLI repair.
//
// Usage:
//   node scripts/prepare-0020-hosted-apply.mjs \
//     --manifest /protected/reviewed-artifacts.csv \
//     --output /protected/0020-0024-hosted.sql

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

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const PREAMBLE_PATH = fileURLToPath(
  new URL('./sql/0020_historical_reconciliation_preamble.sql', import.meta.url),
);
const MANIFEST_HEADER = 'artifact_class,id';
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
  if (!text.endsWith('\n')) throw new Error('manifest must end with one newline');
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

function build(entries, manifestText, preamble = readFileSync(PREAMBLE_PATH, 'utf8')) {
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

  parseManifest(manifestText);
  const marker = '__REVIEWED_ARTIFACT_MANIFEST__';
  if (preamble.split(marker).length !== 2) throw new Error('reconciliation preamble marker mismatch');
  if (/^\s*(?:begin|start\s+transaction|commit|rollback)\s*;/im.test(preamble)) {
    throw new Error('reconciliation preamble contains transaction control');
  }
  const manifestRows = manifestText.slice(MANIFEST_HEADER.length + 1, -1);
  const renderedPreamble = preamble.replace(marker, `${MANIFEST_HEADER}\n${manifestRows}`.trimEnd());

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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (
    args.length !== 4 ||
    args[0] !== '--manifest' ||
    !args[1] ||
    args[2] !== '--output' ||
    !args[3]
  ) {
    throw new Error('Usage: prepare-0020-hosted-apply.mjs --manifest FILE --output FILE');
  }
  const manifest = readFileSync(args[1], 'utf8');
  const entries = loadMigrations();
  const out = build(entries, manifest);
  writeFileSync(args[3], out, { flag: 'wx' });
  const digest = createHash('sha256').update(manifest).digest('hex');
  process.stderr.write(`wrote ${args[3]} (manifest SHA-256 ${digest})\n`);
}

export { ARTIFACT_CLASSES, MANIFEST_HEADER, MIGRATIONS, MIGRATIONS_DIR, build, loadMigrations, parseManifest };
