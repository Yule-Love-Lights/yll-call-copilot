import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  parseGuardedDatabaseArgs,
  runGuardedSupabaseDatabase,
} from './guarded-supabase-db.mjs';
import {
  IDENTITY_MANIFEST_HEADER,
  build,
  loadMigrations,
} from './prepare-0020-hosted-apply.mjs';
import { buildOfficeTasksDriver } from './prepare-office-tasks-hosted-apply.mjs';

const projectRef = 'mjmociuxxxwxvasnpxav';
const secret = 'never-print-this-password';
const sslDirectory = mkdtempSync(join(tmpdir(), 'yll-guarded-ca-test-'));
chmodSync(sslDirectory, 0o700);
const sslRootCertificatePath = join(sslDirectory, 'supabase-ca.crt');
const sslRootCertificate =
  '-----BEGIN CERTIFICATE-----\nTEST-SUPABASE-CA\n-----END CERTIFICATE-----\n';
writeFileSync(sslRootCertificatePath, sslRootCertificate, { mode: 0o600 });
const sslRootCertificateSha256 = createHash('sha256')
  .update(sslRootCertificate)
  .digest('hex');
afterAll(() => rmSync(sslDirectory, { recursive: true, force: true }));

function targetEnv(overrides = {}) {
  return {
    PATH: process.env.PATH,
    YLL_MIGRATION_ENVIRONMENT: 'production',
    YLL_EXPECTED_SUPABASE_PROJECT_REF: projectRef,
    SUPABASE_DB_URL:
      `postgresql://postgres:${secret}@db.${projectRef}.supabase.co:5432/postgres`,
    YLL_EXPECTED_SUPABASE_SSL_ROOT_CERT_SHA256: sslRootCertificateSha256,
    YLL_SUPABASE_SSL_ROOT_CERT: sslRootCertificatePath,
    ...overrides,
  };
}

function temporaryDirectory() {
  return mkdtempSync(join(tmpdir(), 'yll-guarded-db-test-'));
}

function generatedDriver() {
  return build(
    loadMigrations(),
    'artifact_class,id\n',
    `${IDENTITY_MANIFEST_HEADER}\n`,
  );
}

describe('guarded Supabase database wrapper', () => {
  it('exposes only the exact dump and apply command shapes', () => {
    expect(parseGuardedDatabaseArgs(['dump', '--output', '/tmp/new.dump'])).toEqual({
      operation: 'dump',
      path: '/tmp/new.dump',
    });
    const digest = 'a'.repeat(64);
    expect(parseGuardedDatabaseArgs([
      'apply', '--file', '/tmp/reviewed.sql', '--sha256', digest,
    ])).toEqual({
      expectedSha256: digest,
      operation: 'apply',
      path: '/tmp/reviewed.sql',
    });
    expect(parseGuardedDatabaseArgs([
      'apply-office-tasks', '--file', '/tmp/office-tasks.sql', '--sha256', digest,
    ])).toEqual({
      expectedSha256: digest,
      operation: 'apply-office-tasks',
      path: '/tmp/office-tasks.sql',
    });
    for (const args of [
      [],
      ['query', '--file', 'x'],
      ['dump', '--file', 'x'],
      ['apply', '--output', 'x'],
      ['apply', '--file', 'x'],
      ['apply', '--file', 'x', '--sha256', 'not-a-digest'],
      ['apply', '--file', 'x', '--sha256', digest, '--command', 'select 1'],
    ]) {
      expect(() => parseGuardedDatabaseArgs(args)).toThrow(/Usage/);
    }
  });

  it('creates a mode-0600 dump exclusively and streams pg_dump stdout to it', () => {
    const output = join(temporaryDirectory(), 'pre-migration.dump');
    const spawn = vi.fn((command, args, options) => {
      expect(command).toBe('pg_dump');
      expect(args).toEqual(['--format=custom', '--no-password']);
      expect(args.join(' ')).not.toContain(secret);
      expect(options.env).not.toHaveProperty('SUPABASE_DB_URL');
      expect(options.env.PGPASSWORD).toBe(secret);
      expect(options.env.PGSSLMODE).toBe('verify-full');
      expect(options.env.PGSSLROOTCERT).toBe(sslRootCertificatePath);
      expect(options.stdio[0]).toBe('ignore');
      expect(typeof options.stdio[1]).toBe('number');
      expect(options.stdio[2]).toBe('pipe');
      expect(options.timeout).toBe(15 * 60 * 1000);
      writeSync(options.stdio[1], 'protected-dump');
      return { status: 0, stdout: null, stderr: 'suppressed detail' };
    });

    const result = runGuardedSupabaseDatabase(['dump', '--output', output], {
      env: targetEnv(),
      spawn,
    });

    expect(result).toMatchObject({ operation: 'dump', environment: 'production' });
    expect(readFileSync(output, 'utf8')).toBe('protected-dump');
    expect(lstatSync(output).mode & 0o777).toBe(0o600);
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('never overwrites an existing dump output', () => {
    const output = join(temporaryDirectory(), 'existing.dump');
    writeFileSync(output, 'keep-me', { mode: 0o600 });
    const spawn = vi.fn();

    expect(() =>
      runGuardedSupabaseDatabase(['dump', '--output', output], {
        env: targetEnv(),
        spawn,
      }),
    ).toThrow(/created exclusively/);
    expect(readFileSync(output, 'utf8')).toBe('keep-me');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('retains a partial dump and suppresses child output when pg_dump fails', () => {
    const output = join(temporaryDirectory(), 'partial.dump');
    const spawn = (_command, _args, options) => {
      writeSync(options.stdio[1], 'partial');
      return { status: 1, stdout: secret, stderr: secret };
    };

    let message = '';
    try {
      runGuardedSupabaseDatabase(['dump', '--output', output], {
        env: targetEnv(),
        spawn,
      });
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain('child output is suppressed');
    expect(message).not.toContain(secret);
    expect(readFileSync(output, 'utf8')).toBe('partial');
  });

  it('opens one regular input fd and applies it with safe psql flags and captured output', () => {
    const input = join(temporaryDirectory(), 'reviewed.sql');
    const sql = generatedDriver();
    const digest = createHash('sha256').update(sql).digest('hex');
    writeFileSync(input, sql, { mode: 0o600 });
    const spawn = vi.fn((command, args, options) => {
      expect(command).toBe('psql');
      expect(args).toEqual([
        '--no-psqlrc',
        '--no-password',
        '--set=ON_ERROR_STOP=on',
      ]);
      expect(args.join(' ')).not.toContain(secret);
      expect(options.env).not.toHaveProperty('SUPABASE_DB_URL');
      expect(options.env.PGPASSWORD).toBe(secret);
      expect(options.stdio).toEqual(['pipe', 'pipe', 'pipe']);
      expect(options.timeout).toBe(2 * 60 * 1000);
      expect(options.input.toString('utf8')).toBe(sql);
      return { status: 0, stdout: secret, stderr: secret };
    });

    const result = runGuardedSupabaseDatabase([
      'apply', '--file', input, '--sha256', digest,
    ], {
      env: targetEnv(),
      spawn,
    });
    expect(result).toMatchObject({ operation: 'apply', environment: 'production' });
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('rejects missing files, directories, and links before starting psql', () => {
    const directory = temporaryDirectory();
    const input = join(directory, 'reviewed.sql');
    const link = join(directory, 'reviewed-link.sql');
    writeFileSync(input, 'select 1;\n');
    symlinkSync(input, link);
    const spawn = vi.fn();

    for (const path of [join(directory, 'missing.sql'), directory, link]) {
      expect(() =>
        runGuardedSupabaseDatabase([
          'apply', '--file', path, '--sha256', 'a'.repeat(64),
        ], {
          env: targetEnv(),
          spawn,
        }),
      ).toThrow(/regular file/);
    }
    expect(spawn).not.toHaveBeenCalled();
  });

  it('suppresses a thrown child error without exposing secrets', () => {
    const input = join(temporaryDirectory(), 'reviewed.sql');
    const sql = generatedDriver();
    const digest = createHash('sha256').update(sql).digest('hex');
    writeFileSync(input, sql);
    const spawn = () => {
      throw new Error(secret);
    };

    expect(() =>
      runGuardedSupabaseDatabase([
        'apply', '--file', input, '--sha256', digest,
      ], {
        env: targetEnv(),
        spawn,
      }),
    ).toThrow('apply database command could not start; child output is suppressed');
  });

  it('rejects an apply file whose bytes do not match the reviewed SHA-256', () => {
    const input = join(temporaryDirectory(), 'changed.sql');
    writeFileSync(input, 'select 2;\n');
    const spawn = vi.fn();

    expect(() =>
      runGuardedSupabaseDatabase([
        'apply', '--file', input, '--sha256', createHash('sha256').update('select 1;\n').digest('hex'),
      ], {
        env: targetEnv(),
        spawn,
      }),
    ).toThrow(/SHA-256 does not match/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('accepts only the exact generated 0020-0024 driver', () => {
    const directory = temporaryDirectory();
    const deferredIdentity = readFileSync(
      new URL('../supabase/migrations/0025_quote_tool_identity_bridge.sql', import.meta.url),
    );
    const deferredOffice = readFileSync(
      new URL('../supabase/migrations/20260821141530_office_tasks.sql', import.meta.url),
    );
    const generated = generatedDriver();
    const cases = [deferredIdentity, deferredOffice, Buffer.from(`${generated}\nselect 1;\n`)];
    const spawn = vi.fn();

    for (const [index, sql] of cases.entries()) {
      const input = join(directory, `not-driver-${index}.sql`);
      writeFileSync(input, sql);
      const digest = createHash('sha256').update(sql).digest('hex');
      expect(() =>
        runGuardedSupabaseDatabase(
          ['apply', '--file', input, '--sha256', digest],
          { env: targetEnv(), spawn },
        ),
      ).toThrow(/generated 0020-0024|COPY block/);
    }
    expect(spawn).not.toHaveBeenCalled();
  });

  it('accepts only the generated Office Tasks driver on production', () => {
    const input = join(temporaryDirectory(), 'office-tasks.sql');
    const sql = buildOfficeTasksDriver();
    const digest = createHash('sha256').update(sql).digest('hex');
    writeFileSync(input, sql, { mode: 0o600 });
    const spawn = vi.fn(() => ({ status: 0, stdout: '', stderr: '' }));

    expect(runGuardedSupabaseDatabase([
      'apply-office-tasks', '--file', input, '--sha256', digest,
    ], { env: targetEnv(), spawn })).toMatchObject({
      environment: 'production', operation: 'apply-office-tasks',
    });
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('rejects the raw Office Tasks migration even when its digest matches', () => {
    const input = join(temporaryDirectory(), 'raw-office-tasks.sql');
    const sql = readFileSync(
      new URL('../supabase/migrations/20260821141530_office_tasks.sql', import.meta.url),
    );
    writeFileSync(input, sql, { mode: 0o600 });
    const spawn = vi.fn();
    expect(() => runGuardedSupabaseDatabase([
      'apply-office-tasks', '--file', input,
      '--sha256', createHash('sha256').update(sql).digest('hex'),
    ], { env: targetEnv(), spawn })).toThrow(/exact generated Office Tasks driver/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('rejects an Office Tasks apply outside production', () => {
    const input = join(temporaryDirectory(), 'office-tasks.sql');
    const sql = buildOfficeTasksDriver();
    writeFileSync(input, sql, { mode: 0o600 });
    const spawn = vi.fn();
    expect(() => runGuardedSupabaseDatabase([
      'apply-office-tasks', '--file', input,
      '--sha256', createHash('sha256').update(sql).digest('hex'),
    ], {
      env: targetEnv({
        YLL_MIGRATION_ENVIRONMENT: 'staging',
        YLL_EXPECTED_SUPABASE_PROJECT_REF: 'ewbtkrytrnerypdkuimd',
        SUPABASE_DB_URL: 'postgresql://postgres.ewbtkrytrnerypdkuimd:never-print-this-password@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require',
      }),
      spawn,
    })).toThrow(/production only/);
    expect(spawn).not.toHaveBeenCalled();
  });
});
