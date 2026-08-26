import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGuardedSupabaseDatabase } from './guarded-supabase-db.mjs';
import {
  assertLocalMigrationManifest,
  makeRunner,
  parseHistory,
} from './reconcile-0020-0024-hosted-history.mjs';
import { OFFICE_TASKS_PREREQUISITE_HISTORY } from './office-tasks-production-history.mjs';
import {
  OFFICE_TASKS_FILENAME,
  OFFICE_TASKS_VERSION,
  buildOfficeTasksDriver,
} from './prepare-office-tasks-hosted-apply.mjs';
import {
  buildPasswordlessPostgresUrl,
  buildSanitizedPostgresEnv,
  resolveSupabaseDatabaseTarget,
} from './supabase-db-target.mjs';
import { createHash } from 'node:crypto';

const OFFICE_TASKS_HISTORY = Object.freeze({ name: 'office_tasks', version: OFFICE_TASKS_VERSION });

function sameRows(actual, expected) {
  return actual.length === expected.length && actual.every((row, index) =>
    row.version === expected[index].version && row.name === expected[index].name,
  );
}

function classifyOfficeTasksRelease(history, schemaState) {
  const prerequisite = sameRows(history, OFFICE_TASKS_PREREQUISITE_HISTORY);
  const released = sameRows(history, [...OFFICE_TASKS_PREREQUISITE_HISTORY, OFFICE_TASKS_HISTORY]);
  if (prerequisite && schemaState === 'absent') return 'apply-and-record';
  if (prerequisite && schemaState === 'present') return 'record-only';
  if (released && schemaState === 'present') return 'already-released';
  throw new Error('Office Tasks production state is not a reviewed start or recovery state');
}

function readHistory(runner) {
  return parseHistory(runner.psql(`
    select version || chr(9) || coalesce(name, '<null>')
    from supabase_migrations.schema_migrations
    order by version;
  `));
}

function readSchemaState(runner) {
  const output = runner.psql(`
    select case
      when to_regclass('public.ops_tasks') is null
       and to_regclass('public.ops_task_events') is null
       and to_regprocedure('public.ops_create_manual_task(text,text,timestamp with time zone,uuid,uuid)') is null
       and to_regprocedure('public.ops_update_own_task(uuid,text,text,uuid,uuid)') is null
      then 'absent'
      when to_regclass('public.ops_tasks') is not null
       and to_regclass('public.ops_task_events') is not null
       and to_regprocedure('public.ops_create_manual_task(text,text,timestamp with time zone,uuid,uuid)') is not null
       and to_regprocedure('public.ops_update_own_task(uuid,text,text,uuid,uuid)') is not null
      then 'present'
      else 'partial'
    end;
  `).trim();
  if (!['absent', 'present', 'partial'].includes(output)) {
    throw new Error('Office Tasks schema preflight returned an unexpected state');
  }
  return output;
}

function assertOfficeTasksPostconditions(runner) {
  const output = runner.psql(`
    select case when
      to_regclass('public.ops_tasks') is not null
      and to_regclass('public.ops_task_events') is not null
      and to_regprocedure('public.ops_create_manual_task(text,text,timestamp with time zone,uuid,uuid)') is not null
      and to_regprocedure('public.ops_update_own_task(uuid,text,text,uuid,uuid)') is not null
      and exists (select 1 from pg_class where oid = 'public.ops_tasks'::regclass and relrowsecurity and relforcerowsecurity)
      and exists (select 1 from pg_class where oid = 'public.ops_task_events'::regclass and relrowsecurity and relforcerowsecurity)
      and not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('ops_tasks', 'ops_task_events'))
      and has_function_privilege('service_role', 'public.ops_create_manual_task(text,text,timestamp with time zone,uuid,uuid)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.ops_update_own_task(uuid,text,text,uuid,uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.ops_create_manual_task(text,text,timestamp with time zone,uuid,uuid)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.ops_update_own_task(uuid,text,text,uuid,uuid)', 'EXECUTE')
    then 'YLL_OFFICE_TASKS_OK' else 'YLL_OFFICE_TASKS_MISMATCH' end;
  `);
  if (!output.split('\n').includes('YLL_OFFICE_TASKS_OK')) {
    throw new Error('Office Tasks post-apply verification failed');
  }
}

function assertExpectedSourceIdentityMigrations(output) {
  const mentioned = [...output.matchAll(/\b\d+_[A-Za-z0-9][A-Za-z0-9_-]*\.sql\b/g)]
    .map(match => match[0]).sort();
  const expected = [
    '0025_quote_tool_identity_bridge.sql',
    '20260825120136_production_quote_tool_identity_activation.sql',
  ];
  if (JSON.stringify(mentioned) !== JSON.stringify(expected)) {
    throw new Error('Post-release dry run does not report only the known source identity migrations');
  }
}

function writeDriver(driver) {
  const directory = mkdtempSync(join(tmpdir(), 'yll-office-tasks-release-'));
  chmodSync(directory, 0o700);
  const path = join(directory, 'office-tasks.sql');
  writeFileSync(path, driver, { flag: 'wx', mode: 0o600 });
  return { directory, path };
}

function main() {
  assertLocalMigrationManifest();
  const target = resolveSupabaseDatabaseTarget();
  if (target.environment !== 'production') {
    throw new Error('Office Tasks release runner may target production only');
  }
  const runner = makeRunner({
    localContainer: null,
    passwordlessDbUrl: buildPasswordlessPostgresUrl(target),
    postgresEnv: buildSanitizedPostgresEnv(process.env, target),
    projectRef: target.projectRef,
  });
  let driver = null;
  try {
    const state = classifyOfficeTasksRelease(readHistory(runner), readSchemaState(runner));
    if (state === 'apply-and-record') {
      const sql = buildOfficeTasksDriver();
      driver = writeDriver(sql);
      runGuardedSupabaseDatabase([
        'apply-office-tasks', '--file', driver.path, '--sha256', createHash('sha256').update(sql).digest('hex'),
      ]);
    }
    if (state === 'apply-and-record' || state === 'record-only') {
      runner.supabase(
        ['migration', 'repair', OFFICE_TASKS_VERSION, '--status', 'applied'],
        'Office Tasks migration-history repair',
      );
    }
    if (!sameRows(readHistory(runner), [...OFFICE_TASKS_PREREQUISITE_HISTORY, OFFICE_TASKS_HISTORY])) {
      throw new Error('Office Tasks migration history verification failed');
    }
    assertOfficeTasksPostconditions(runner);
    assertExpectedSourceIdentityMigrations(runner.supabase(['db', 'push', '--dry-run'], 'Office Tasks post-release dry run'));
    process.stdout.write(`OFFICE_TASKS_RELEASE_OK migration=${OFFICE_TASKS_FILENAME}\n`);
  } finally {
    if (driver) rmSync(driver.directory, { recursive: true, force: true });
    runner.cleanup();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(); } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}

export {
  OFFICE_TASKS_HISTORY,
  assertExpectedSourceIdentityMigrations,
  assertOfficeTasksPostconditions,
  classifyOfficeTasksRelease,
  readHistory,
  readSchemaState,
  sameRows,
};
