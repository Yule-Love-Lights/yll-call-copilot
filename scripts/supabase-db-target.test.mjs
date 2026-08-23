import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  SUPABASE_PROJECT_REFS,
  buildPasswordlessPostgresUrl,
  buildSanitizedSupabaseCliEnv,
  buildSanitizedPostgresEnv,
  resolveSupabaseDatabaseTarget,
} from './supabase-db-target.mjs';

const productionRef = SUPABASE_PROJECT_REFS.production;
const stagingRef = SUPABASE_PROJECT_REFS.staging;
const secret = 'not-for-output';
const sslDirectory = mkdtempSync(join(tmpdir(), 'yll-target-ca-test-'));
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

function productionEnv(overrides = {}) {
  return {
    ...sslEnvironment(),
    YLL_MIGRATION_ENVIRONMENT: 'production',
    YLL_EXPECTED_SUPABASE_PROJECT_REF: productionRef,
    SUPABASE_DB_URL:
      `postgresql://postgres:${secret}@db.${productionRef}.supabase.co:5432/postgres`,
    ...overrides,
  };
}

describe('Supabase migration target guard', () => {
  it('accepts only the frozen production direct target', () => {
    const target = resolveSupabaseDatabaseTarget(productionEnv());
    expect(target).toMatchObject({
      connectionMode: 'direct',
      environment: 'production',
      hostname: `db.${productionRef}.supabase.co`,
      projectRef: productionRef,
      username: 'postgres',
    });
  });

  it('accepts the frozen staging session-pooler target on port 5432', () => {
    const target = resolveSupabaseDatabaseTarget({
      ...sslEnvironment(),
      YLL_MIGRATION_ENVIRONMENT: 'staging',
      YLL_EXPECTED_SUPABASE_PROJECT_REF: stagingRef,
      SUPABASE_DB_URL:
        `postgres://postgres.${stagingRef}:p%40ss@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require`,
    });
    expect(target).toMatchObject({
      connectionMode: 'session-pooler',
      environment: 'staging',
      password: 'p@ss',
      projectRef: stagingRef,
      username: `postgres.${stagingRef}`,
    });
  });

  it('requires all three target declarations to agree', () => {
    expect(() =>
      resolveSupabaseDatabaseTarget(productionEnv({
        YLL_MIGRATION_ENVIRONMENT: 'preview',
      })),
    ).toThrow(/exactly staging or production/);
    expect(() =>
      resolveSupabaseDatabaseTarget(productionEnv({
        YLL_EXPECTED_SUPABASE_PROJECT_REF: stagingRef,
      })),
    ).toThrow(/does not match the frozen migration environment/);
    expect(() =>
      resolveSupabaseDatabaseTarget(productionEnv({
        SUPABASE_DB_URL:
          `postgresql://postgres:${secret}@db.${stagingRef}.supabase.co:5432/postgres`,
      })),
    ).toThrow(/host and user do not match/);
    expect(() =>
      resolveSupabaseDatabaseTarget(productionEnv({
        SUPABASE_DB_URL:
          `postgresql://postgres.${stagingRef}:${secret}@aws-0-us-east-2.pooler.supabase.com:5432/postgres`,
      })),
    ).toThrow(/host and user do not match/);
  });

  it('rejects unsafe protocols, ports, database names, and URL options', () => {
    for (const url of [
      `https://postgres:${secret}@db.${productionRef}.supabase.co:5432/postgres`,
      `postgresql://postgres:${secret}@db.${productionRef}.supabase.co:6543/postgres`,
      `postgresql://postgres:${secret}@db.${productionRef}.supabase.co/postgres`,
      `postgresql://postgres:${secret}@db.${productionRef}.supabase.co:5432/template1`,
      `postgresql://postgres:${secret}@db.${productionRef}.supabase.co:5432/postgres?sslmode=disable`,
      `postgresql://postgres:${secret}@db.${productionRef}.supabase.co:5432/postgres?hostaddr=127.0.0.1`,
    ]) {
      expect(() =>
        resolveSupabaseDatabaseTarget(productionEnv({ SUPABASE_DB_URL: url })),
      ).toThrow();
    }
  });

  it('requires exact direct and session-pooler host, user, and database shapes', () => {
    for (const url of [
      `postgresql://postgres.wrong:${secret}@db.${productionRef}.supabase.co:5432/postgres`,
      `postgresql://postgres:${secret}@evil.${productionRef}.supabase.co:5432/postgres`,
      `postgresql://postgres.${productionRef}:${secret}@pooler.supabase.com:5432/postgres`,
      `postgresql://postgres.${productionRef}:${secret}@aws-0-us-east-2.pooler.supabase.com.evil.test:5432/postgres`,
    ]) {
      expect(() =>
        resolveSupabaseDatabaseTarget(productionEnv({ SUPABASE_DB_URL: url })),
      ).toThrow(/host and user do not match/);
    }
  });

  it('derives a clean libpq environment and removes the URL and inherited PG overrides', () => {
    const env = productionEnv({
      PATH: '/safe/bin',
      PGHOSTADDR: '127.0.0.1',
      PGSERVICE: 'wrong',
      PGSERVICEFILE: '/tmp/wrong',
      PGOPTIONS: '-c search_path=wrong',
      PGSSLMODE: 'disable',
      NODE_OPTIONS: '--require attacker.js',
      NPM_CONFIG_REGISTRY: 'https://attacker.invalid',
      SUPABASE_API_URL: 'https://attacker.invalid',
      SUPABASE_PROJECT_HOST: 'attacker.invalid',
    });
    const target = resolveSupabaseDatabaseTarget(env);
    const childEnv = buildSanitizedPostgresEnv(env, target);

    expect(childEnv).toMatchObject({
      PATH: '/opt/homebrew/opt/libpq@17/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      PGDATABASE: 'postgres',
      PGHOST: `db.${productionRef}.supabase.co`,
      PGPASSWORD: secret,
      PGPORT: '5432',
      PGGSSENCMODE: 'disable',
      PGSSLCERTMODE: 'disable',
      PGSSLMODE: 'verify-full',
      PGSSLROOTCERT: sslRootCertificatePath,
      PGUSER: 'postgres',
    });
    expect(childEnv).not.toHaveProperty('SUPABASE_DB_URL');
    expect(childEnv).not.toHaveProperty('PGHOSTADDR');
    expect(childEnv).not.toHaveProperty('PGSERVICE');
    expect(childEnv).not.toHaveProperty('PGSERVICEFILE');
    expect(childEnv).not.toHaveProperty('PGOPTIONS');
    expect(childEnv).not.toHaveProperty('NODE_OPTIONS');
    expect(childEnv).not.toHaveProperty('NPM_CONFIG_REGISTRY');
    expect(childEnv).not.toHaveProperty('SUPABASE_API_URL');
    expect(childEnv).not.toHaveProperty('SUPABASE_PROJECT_HOST');
  });

  it('builds a passwordless exact-target CLI URL with full TLS verification', () => {
    const target = resolveSupabaseDatabaseTarget(productionEnv());
    const url = new URL(buildPasswordlessPostgresUrl(target));

    expect(url.protocol).toBe('postgresql:');
    expect(url.username).toBe('postgres');
    expect(url.password).toBe('');
    expect(url.hostname).toBe(`db.${productionRef}.supabase.co`);
    expect(url.port).toBe('5432');
    expect(url.pathname).toBe('/postgres');
    expect([...url.searchParams.entries()]).toEqual([
      ['connect_timeout', '10'],
      ['sslmode', 'verify-full'],
      ['sslrootcert', sslRootCertificatePath],
    ]);
    expect(url.toString()).not.toContain(secret);
  });

  it('gives the Supabase CLI only the exact libpq target and safe process settings', () => {
    const env = productionEnv({
      HOME: '/tmp/attacker-home',
      NODE_OPTIONS: '--require attacker.js',
      NPM_CONFIG_REGISTRY: 'https://attacker.invalid',
      SUPABASE_API_URL: 'https://attacker.invalid',
      SUPABASE_PROJECT_HOST: 'attacker.invalid',
      SUPABASE_CLI_BINARY_OVERRIDE: '/tmp/attacker-cli',
    });
    const target = resolveSupabaseDatabaseTarget(env);
    const postgresEnv = buildSanitizedPostgresEnv(env, target);
    expect(buildSanitizedSupabaseCliEnv(postgresEnv, '/private/tmp/yll-cli-home')).toEqual({
      LANG: 'C',
      LC_ALL: 'C',
      PATH: '/opt/homebrew/opt/libpq@17/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      PGDATABASE: 'postgres',
      PGHOST: `db.${productionRef}.supabase.co`,
      PGPASSWORD: secret,
      PGPORT: '5432',
      PGGSSENCMODE: 'disable',
      PGSSLCERTMODE: 'disable',
      PGSSLMODE: 'verify-full',
      PGSSLROOTCERT: sslRootCertificatePath,
      PGUSER: 'postgres',
      SUPABASE_HOME: '/private/tmp/yll-cli-home',
      SUPABASE_PROFILE: 'supabase',
    });
  });

  it('requires an absolute private Supabase CLI home path', () => {
    const env = productionEnv();
    const target = resolveSupabaseDatabaseTarget(env);
    const postgresEnv = buildSanitizedPostgresEnv(env, target);
    expect(() => buildSanitizedSupabaseCliEnv(postgresEnv, 'relative/home')).toThrow(
      /absolute private directory/,
    );
  });

  it('does not include the connection secret in validation errors', () => {
    let message = '';
    try {
      resolveSupabaseDatabaseTarget(productionEnv({
        SUPABASE_DB_URL: `postgresql://postgres:${secret}@evil.test:5432/postgres`,
      }));
    } catch (error) {
      message = String(error);
    }
    expect(message).not.toContain(secret);
  });

  it('requires an exact protected reviewed Supabase CA certificate', () => {
    expect(() =>
      resolveSupabaseDatabaseTarget(productionEnv({
        YLL_EXPECTED_SUPABASE_SSL_ROOT_CERT_SHA256: 'a'.repeat(64),
      })),
    ).toThrow(/SHA-256 does not match/);

    const permissiveDirectory = mkdtempSync(join(tmpdir(), 'yll-target-open-ca-test-'));
    const permissiveCertificate = join(permissiveDirectory, 'supabase-ca.crt');
    try {
      chmodSync(permissiveDirectory, 0o755);
      writeFileSync(permissiveCertificate, sslRootCertificate, { mode: 0o600 });
      expect(() =>
        resolveSupabaseDatabaseTarget(productionEnv({
          YLL_SUPABASE_SSL_ROOT_CERT: permissiveCertificate,
        })),
      ).toThrow(/protected regular file/);
    } finally {
      rmSync(permissiveDirectory, { recursive: true, force: true });
    }
  });
});
