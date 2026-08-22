import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildSanitizedPostgresEnv,
  resolveSupabaseDatabaseTarget,
} from './supabase-db-target.mjs';
import { assertGeneratedHostedDriver } from './prepare-0020-hosted-apply.mjs';

function parseGuardedDatabaseArgs(args) {
  if (
    args.length === 3
    && args[0] === 'dump'
    && args[1] === '--output'
    && args[2]
  ) {
    return { operation: 'dump', path: args[2] };
  }
  if (
    args.length === 5
    && args[0] === 'apply'
    && args[1] === '--file'
    && args[2]
    && args[3] === '--sha256'
    && /^[0-9a-f]{64}$/.test(args[4])
  ) {
    return { expectedSha256: args[4], operation: 'apply', path: args[2] };
  }
  throw new Error(
    'Usage: guarded-supabase-db.mjs dump --output FILE | apply --file FILE --sha256 HEX',
  );
}

function runChild(spawn, command, args, options, operation) {
  let result;
  try {
    result = spawn(command, args, options);
  } catch {
    throw new Error(`${operation} database command could not start; child output is suppressed`);
  }
  if (result.error) {
    throw new Error(`${operation} database command could not start; child output is suppressed`);
  }
  if (result.status !== 0) {
    const retention = operation === 'dump' ? ' and partial dump is retained' : '';
    throw new Error(
      `${operation} database command failed; child output is suppressed${retention}`,
    );
  }
}

function runDump(path, childEnv, spawn) {
  let output;
  try {
    output = openSync(path, 'wx', 0o600);
  } catch {
    throw new Error('dump output must be a new file that can be created exclusively');
  }

  try {
    runChild(
      spawn,
      'pg_dump',
      ['--format=custom', '--no-password'],
      {
        encoding: 'utf8',
        env: childEnv,
        stdio: ['ignore', output, 'pipe'],
        timeout: 15 * 60 * 1000,
      },
      'dump',
    );
  } finally {
    closeSync(output);
  }
}

function openRegularInputFile(path) {
  let input;
  try {
    input = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new Error('apply input must be an existing regular file');
  }
  if (!fstatSync(input).isFile()) {
    closeSync(input);
    throw new Error('apply input must be an existing regular file, not a link or directory');
  }
  return input;
}

function runApply(path, expectedSha256, childEnv, spawn) {
  const input = openRegularInputFile(path);
  let sql;
  try {
    sql = readFileSync(input);
  } finally {
    closeSync(input);
  }
  const actualSha256 = createHash('sha256').update(sql).digest('hex');
  if (actualSha256 !== expectedSha256) {
    throw new Error('apply input SHA-256 does not match the reviewed driver');
  }
  assertGeneratedHostedDriver(sql);
  runChild(
    spawn,
    'psql',
    ['--no-psqlrc', '--no-password', '--set=ON_ERROR_STOP=on'],
    {
      encoding: 'utf8',
      env: childEnv,
      input: sql,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 2 * 60 * 1000,
    },
    'apply',
  );
}

function runGuardedSupabaseDatabase(args, options = {}) {
  const parsedArgs = parseGuardedDatabaseArgs(args);
  const env = options.env ?? process.env;
  const spawn = options.spawn ?? spawnSync;
  const target = resolveSupabaseDatabaseTarget(env);
  const childEnv = buildSanitizedPostgresEnv(env, target);

  if (parsedArgs.operation === 'dump') {
    runDump(parsedArgs.path, childEnv, spawn);
  } else {
    runApply(parsedArgs.path, parsedArgs.expectedSha256, childEnv, spawn);
  }

  return Object.freeze({
    connectionMode: target.connectionMode,
    environment: target.environment,
    operation: parsedArgs.operation,
    projectRef: target.projectRef,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const result = runGuardedSupabaseDatabase(process.argv.slice(2));
    process.stdout.write(
      `GUARDED_SUPABASE_DB_OK operation=${result.operation} environment=${result.environment}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'guarded database command failed';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

export { parseGuardedDatabaseArgs, runGuardedSupabaseDatabase };
