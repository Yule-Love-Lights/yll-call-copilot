// Exports the exact pre-0020 review set from the frozen production database.
// Customer and employee rows go only to a caller-provided mode-0700 directory;
// child output and credentials are never printed.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildSanitizedPostgresEnv,
  resolveSupabaseDatabaseTarget,
} from './supabase-db-target.mjs';
import { EXPECTED_PREAMBLE_SHA256 } from './prepare-0020-hosted-apply.mjs';

const EXPORT_FILES = Object.freeze([
  'weekly_digests.csv',
  'brain_reviews.csv',
  'playbook_proposals.csv',
  'edited_playbook_versions.csv',
  'unsafe_personal_touches.csv',
  'orphan_call_scores.csv',
  'affected_verticals.csv',
  'retained_generated_playbook_versions.csv',
  'orphan_feedback_cards.csv',
  'identity-backfill-map.csv',
  'reviewed-identity-backfill.csv',
  'reviewed-metric-artifacts.csv',
  'artifact-counts.csv',
  'production-preflight.csv',
]);
const EXPORT_DIGEST_INDEX = 'export-file-digests.sha256';

const PREAMBLE_PATH = fileURLToPath(
  new URL('./sql/0020_historical_reconciliation_preamble.sql', import.meta.url),
);
const PREAMBLE = readFileSync(PREAMBLE_PATH, 'utf8');
if (createHash('sha256').update(PREAMBLE).digest('hex') !== EXPECTED_PREAMBLE_SHA256) {
  throw new Error('reconciliation preamble SHA-256 no longer matches review');
}
const CURRENT_ARTIFACTS_MATCH = PREAMBLE.match(
  /insert into current_metric_artifacts \(artifact_class, id\)\n([\s\S]*?);\n\ndo \$reviewed_manifest_guard\$/,
);
if (!CURRENT_ARTIFACTS_MATCH) {
  throw new Error('could not extract the canonical six-class artifact selection');
}
const CURRENT_ARTIFACTS_QUERY = CURRENT_ARTIFACTS_MATCH[1];
const CURRENT_ARTIFACTS_CTE = `
  with current_metric_artifacts(artifact_class, id) as (${CURRENT_ARTIFACTS_QUERY})
`;

const EXPORT_QUERIES = Object.freeze({
  'weekly_digests.csv': `select artifact.* from public.weekly_digests as artifact order by id`,
  'brain_reviews.csv': `select artifact.* from public.brain_reviews as artifact order by id`,
  'playbook_proposals.csv': `select artifact.* from public.playbook_proposals as artifact order by id`,
  'edited_playbook_versions.csv': `
    select artifact.*
    from public.playbook_versions as artifact
    where source = 'edited'
    order by id
  `,
  'unsafe_personal_touches.csv': `
    ${CURRENT_ARTIFACTS_CTE}
    select touch_record.*
    from public.second_mile_touches as touch_record
    join current_metric_artifacts as current
      on current.artifact_class = 'unsafe_personal_touch'
      and current.id = touch_record.id
    order by touch_record.id
  `,
  'orphan_call_scores.csv': `
    ${CURRENT_ARTIFACTS_CTE}
    select score_record.*
    from public.call_scores as score_record
    join current_metric_artifacts as current
      on current.artifact_class = 'orphan_call_score'
      and current.id = score_record.id
    order by score_record.id
  `,
  'affected_verticals.csv': `
    select distinct vertical_record.*
    from public.verticals as vertical_record
    join public.playbook_versions as edited
      on edited.vertical_id = vertical_record.id
      and edited.source = 'edited'
    order by vertical_record.id
  `,
  'retained_generated_playbook_versions.csv': `
    select distinct generated.*
    from public.playbook_versions as generated
    join public.playbook_versions as edited
      on edited.vertical_id = generated.vertical_id
      and edited.source = 'edited'
    where generated.source = 'generated'
    order by generated.id
  `,
  'orphan_feedback_cards.csv': `
    ${CURRENT_ARTIFACTS_CTE}
    select feedback.*
    from public.feedback_cards as feedback
    join current_metric_artifacts as current
      on current.artifact_class = 'orphan_call_score'
      and current.id = feedback.call_score_id
    order by feedback.id
  `,
  'identity-backfill-map.csv': `
    select
      legacy_user.id as employee_id,
      lower(btrim(legacy_user.email)) as normalized_email,
      lower(btrim(legacy_user.role)) as legacy_role,
      case lower(btrim(legacy_user.role))
        when 'rep' then 'office'
        else lower(btrim(legacy_user.role))
      end as backfilled_role,
      legacy_user.created_at as legacy_created_at,
      auth_user.id as auth_user_id
    from public.app_users as legacy_user
    join auth.users as auth_user
      on lower(btrim(auth_user.email)) = lower(btrim(legacy_user.email))
    order by legacy_user.id, auth_user.id
  `,
  'reviewed-identity-backfill.csv': `
    select
      legacy_user.id as employee_id,
      encode(convert_to(lower(btrim(legacy_user.email)), 'UTF8'), 'hex')
        as normalized_email_hex,
      lower(btrim(legacy_user.role)) as legacy_role,
      case lower(btrim(legacy_user.role))
        when 'rep' then 'office'
        else lower(btrim(legacy_user.role))
      end as backfilled_role,
      case
        when legacy_user.created_at is null then null
        else extract(epoch from legacy_user.created_at)::text
      end as legacy_created_at_epoch,
      auth_user.id as auth_user_id
    from public.app_users as legacy_user
    join auth.users as auth_user
      on lower(btrim(auth_user.email)) = lower(btrim(legacy_user.email))
    order by legacy_user.id, auth_user.id
  `,
  'reviewed-metric-artifacts.csv': `
    ${CURRENT_ARTIFACTS_CTE}
    select artifact_class, id
    from current_metric_artifacts
    order by artifact_class, id
  `,
  'artifact-counts.csv': `
    ${CURRENT_ARTIFACTS_CTE},
    artifact_classes(artifact_class) as (
      values
        ('weekly_digest'),
        ('brain_review'),
        ('playbook_proposal'),
        ('edited_playbook_version'),
        ('unsafe_personal_touch'),
        ('orphan_call_score')
    )
    select artifact_classes.artifact_class, count(current_metric_artifacts.id) as row_count
    from artifact_classes
    left join current_metric_artifacts using (artifact_class)
    group by artifact_classes.artifact_class
    order by artifact_classes.artifact_class
  `,
  'production-preflight.csv': `
    select
      (select count(*) from public.app_users) as app_users,
      (
        select count(*)
        from public.app_users as legacy_user
        where nullif(btrim(legacy_user.email), '') is null
          or lower(btrim(legacy_user.email)) not like '%@%'
          or exists (
            select 1
            from auth.users as auth_user
            where lower(btrim(auth_user.email)) = lower(btrim(legacy_user.email))
              and (
                nullif(btrim(auth_user.email), '') is null
                or lower(btrim(auth_user.email)) not like '%@%'
              )
          )
      ) as malformed_identity_emails,
      (
        select count(*)
        from public.app_users as legacy_user
        where lower(btrim(legacy_user.role)) not in ('rep', 'office', 'owner', 'admin')
      ) as unsupported_roles,
      (
        select coalesce(sum(duplicate_group.group_count), 0)::bigint
        from (
          select count(*)::bigint as group_count
          from public.app_users as legacy_user
          group by lower(btrim(legacy_user.email))
          having count(*) > 1
        ) as duplicate_group
      ) as duplicate_normalized_emails,
      (
        select count(*)
        from public.app_users as legacy_user
        where not exists (
          select 1 from auth.users as auth_user
          where lower(btrim(auth_user.email)) = lower(btrim(legacy_user.email))
        )
      ) as missing_auth_matches,
      (
        select count(*)
        from public.app_users as legacy_user
        where (
          select count(*) from auth.users as auth_user
          where lower(btrim(auth_user.email)) = lower(btrim(legacy_user.email))
        ) > 1
      ) as ambiguous_auth_matches,
      (
        select count(*)
        from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
      ) as public_tables,
      (
        select count(*)
        from pg_proc as routine
        join pg_namespace as namespace on namespace.oid = routine.pronamespace
        where namespace.nspname = 'public' and routine.prokind in ('f', 'p')
      ) as public_routines,
      (
        select count(*)
        from pg_trigger as trigger_record
        join pg_class as relation on relation.oid = trigger_record.tgrelid
        join pg_namespace as namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public' and not trigger_record.tgisinternal
      ) as non_internal_triggers,
      (
        select count(*) from information_schema.views where table_schema = 'public'
      ) as public_views,
      (select count(*) from pg_policies where schemaname = 'public') as public_policies,
      (
        select count(*) from information_schema.sequences where sequence_schema = 'public'
      ) as public_sequences,
      (
        select count(*)
        from pg_class as relation
        join pg_namespace as namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relkind in ('r', 'p')
          and (not relation.relrowsecurity or not relation.relforcerowsecurity)
      ) as public_tables_not_forced_rls,
      (
        select count(*)
        from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('anon', 'authenticated')
      ) as browser_table_grants,
      coalesce(
        (select rolbypassrls from pg_roles where rolname = 'service_role'),
        false
      ) as service_role_bypassrls,
      (
        select count(*) from pg_publication_tables where schemaname = 'public'
      ) as public_publication_tables,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'transcripts'
          and column_name = 'metric_scope'
      ) as has_metric_scope,
      (to_regclass('public.call_commitments') is not null) as has_call_commitments,
      (
        select count(*)
        from information_schema.tables
        where table_schema = 'public' and table_name like 'ops_%'
      ) as ops_tables,
      (
        to_regprocedure('public.advance_recording_sync_cursor(timestamp with time zone,jsonb)')
          is not null
      ) as has_recording_cursor_rpc
  `,
});

function psqlFileLiteral(path) {
  if (path.includes('\0') || path.includes('\n') || path.includes('\r')) {
    throw new Error('export directory contains an unsupported character');
  }
  return `'${path.replaceAll("'", "''")}'`;
}

function oneLineSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function buildExportSql(directory) {
  const commands = EXPORT_FILES.map(filename => {
    const query = EXPORT_QUERIES[filename];
    const path = `${directory}/${filename}`;
    return `\\copy (${oneLineSql(query)}) to ${psqlFileLiteral(path)} with (format csv, header true)`;
  });
  return `\\set ON_ERROR_STOP on
begin transaction isolation level repeatable read read only;
set local statement_timeout = '5min';
${commands.join('\n')}
commit;
`;
}

function assertProtectedEmptyDirectory(rawDirectory) {
  const directory = resolve(rawDirectory);
  if (directory !== rawDirectory) {
    throw new Error('export directory must be an absolute normalized path');
  }
  let entry;
  try {
    entry = lstatSync(directory);
  } catch {
    throw new Error('export directory must already exist');
  }
  if (!entry.isDirectory() || entry.isSymbolicLink() || (entry.mode & 0o077) !== 0) {
    throw new Error('export directory must be a real directory with no group or other access');
  }
  if (readdirSync(directory).length !== 0) {
    throw new Error('export directory must be empty');
  }
  for (const filename of [...EXPORT_FILES, EXPORT_DIGEST_INDEX]) {
    if (existsSync(`${directory}/${filename}`)) {
      throw new Error('export output already exists; use a new protected directory');
    }
  }
  return directory;
}

function runProductionReviewExport(rawDirectory, options = {}) {
  const env = options.env ?? process.env;
  const spawn = options.spawn ?? spawnSync;
  const expectedExportSetSha256 = options.expectedExportSetSha256;
  if (
    expectedExportSetSha256 !== undefined
    && !/^[0-9a-f]{64}$/.test(expectedExportSetSha256)
  ) {
    throw new Error('expected export-set SHA-256 must be exactly 64 lowercase hex characters');
  }
  const target = resolveSupabaseDatabaseTarget(env);
  if (target.environment !== 'production') {
    throw new Error('the 0020 production review exporter accepts only the frozen production target');
  }
  const directory = assertProtectedEmptyDirectory(rawDirectory);
  const sql = buildExportSql(directory);
  const previousUmask = process.umask(0o077);
  let result;
  try {
    result = spawn(
      'psql',
      ['--no-psqlrc', '--no-password', '--set=ON_ERROR_STOP=on'],
      {
        encoding: 'utf8',
        env: buildSanitizedPostgresEnv(env, target),
        input: sql,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 6 * 60 * 1000,
      },
    );
  } catch {
    throw new Error('production review export could not start; child output is suppressed');
  } finally {
    process.umask(previousUmask);
  }
  if (result.error || result.status !== 0) {
    throw new Error('production review export failed; child output is suppressed');
  }

  let exportSetSha256;
  try {
    const digestLines = [];
    for (const filename of EXPORT_FILES) {
      const path = `${directory}/${filename}`;
      const entry = lstatSync(path);
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new Error('unsafe export output');
      }
      chmodSync(path, 0o600);
      const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
      digestLines.push(`${digest}  ${filename}`);
    }
    const digestIndex = `${digestLines.join('\n')}\n`;
    exportSetSha256 = createHash('sha256').update(digestIndex).digest('hex');
    writeFileSync(`${directory}/${EXPORT_DIGEST_INDEX}`, digestIndex, {
      flag: 'wx',
      mode: 0o600,
    });
  } catch {
    throw new Error('production review export outputs could not be verified safely');
  }

  for (const filename of [...EXPORT_FILES, EXPORT_DIGEST_INDEX]) {
    const path = `${directory}/${filename}`;
    try {
      const entry = lstatSync(path);
      if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o077) !== 0) {
        throw new Error('unsafe output');
      }
    } catch {
      throw new Error('production review export did not create every protected required file');
    }
  }

  if (expectedExportSetSha256 && exportSetSha256 !== expectedExportSetSha256) {
    throw new Error('production review export set does not match the authorized SHA-256');
  }

  return Object.freeze({
    directory,
    environment: target.environment,
    exportSetSha256,
    files: EXPORT_FILES.length + 1,
    projectRef: target.projectRef,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const args = process.argv.slice(2);
    if (
      !(
        (args.length === 2 && args[0] === '--directory' && args[1])
        || (
          args.length === 4
          && args[0] === '--directory'
          && args[1]
          && args[2] === '--expected-export-set-sha256'
          && args[3]
        )
      )
    ) {
      throw new Error(
        'Usage: export-0020-production-review.mjs --directory ABSOLUTE_DIRECTORY [--expected-export-set-sha256 HEX]',
      );
    }
    const result = runProductionReviewExport(args[1], {
      expectedExportSetSha256: args[3],
    });
    process.stdout.write(
      `PRODUCTION_0020_REVIEW_EXPORT_OK environment=${result.environment} files=${result.files} export_set_sha256=${result.exportSetSha256}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'production review export failed';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

export {
  CURRENT_ARTIFACTS_QUERY,
  EXPORT_DIGEST_INDEX,
  EXPORT_FILES,
  EXPORT_QUERIES,
  buildExportSql,
  runProductionReviewExport,
};
