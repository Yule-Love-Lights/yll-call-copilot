import { afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CURRENT_ARTIFACTS_QUERY,
  EXPORT_DIGEST_INDEX,
  EXPORT_FILES,
  buildExportSql,
  runProductionReviewExport,
} from './export-0020-production-review.mjs';

const productionRef = 'mjmociuxxxwxvasnpxav';
const secret = 'never-print-this-password';
const sslDirectory = mkdtempSync(join(tmpdir(), 'yll-export-ca-test-'));
chmodSync(sslDirectory, 0o700);
const sslRootCertificatePath = join(sslDirectory, 'supabase-ca.crt');
const sslRootCertificate =
  '-----BEGIN CERTIFICATE-----\nTEST-SUPABASE-CA\n-----END CERTIFICATE-----\n';
writeFileSync(sslRootCertificatePath, sslRootCertificate, { mode: 0o600 });
const sslRootCertificateSha256 = createHash('sha256')
  .update(sslRootCertificate)
  .digest('hex');
afterAll(() => rmSync(sslDirectory, { recursive: true, force: true }));

const productionEnv = {
  SUPABASE_DB_URL:
    `postgresql://postgres:${secret}@db.${productionRef}.supabase.co:5432/postgres`,
  YLL_EXPECTED_SUPABASE_PROJECT_REF: productionRef,
  YLL_EXPECTED_SUPABASE_SSL_ROOT_CERT_SHA256: sslRootCertificateSha256,
  YLL_MIGRATION_ENVIRONMENT: 'production',
  YLL_SUPABASE_SSL_ROOT_CERT: sslRootCertificatePath,
};

function protectedDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'yll-0020-export-'));
  chmodSync(directory, 0o700);
  return directory;
}

function mockSuccessfulPsql(calls) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    for (const match of options.input.matchAll(/to '([^']+)' with \(format csv, header true\)/g)) {
      writeFileSync(match[1], 'header\n', { flag: 'wx', mode: 0o666 });
    }
    return { status: 0, stdout: '', stderr: '' };
  };
}

describe('production 0020 review export', () => {
  it('uses one read-only snapshot and the canonical six-class selection', () => {
    const sql = buildExportSql('/protected/review');
    expect(sql).toContain('begin transaction isolation level repeatable read read only;');
    expect(sql).toContain('reviewed-metric-artifacts.csv');
    expect(sql).toContain('production-preflight.csv');
    expect(sql).toContain('identity-backfill-map.csv');
    expect(sql).toContain('reviewed-identity-backfill.csv');
    expect(sql).toContain('normalized_email');
    expect(sql).toContain('normalized_email_hex');
    expect(sql).toContain('legacy_created_at');
    expect(sql).toContain('backfilled_role');
    expect(sql).toContain('auth_user_id');
    expect(sql.match(/\\copy /g)).toHaveLength(EXPORT_FILES.length);

    const preamble = readFileSync(
      new URL('./sql/0020_historical_reconciliation_preamble.sql', import.meta.url),
      'utf8',
    ).replace(/\s+/g, ' ');
    expect(preamble).toContain(CURRENT_ARTIFACTS_QUERY.replace(/\s+/g, ' ').trim());
  });

  it('exports only through the frozen production target without exposing credentials', () => {
    const directory = protectedDirectory();
    const calls = [];
    try {
      const result = runProductionReviewExport(directory, {
        env: {
          ...productionEnv,
          NODE_OPTIONS: '--require attacker.js',
          PGHOSTADDR: '127.0.0.1',
          SUPABASE_API_URL: 'https://attacker.invalid',
        },
        spawn: mockSuccessfulPsql(calls),
      });

      expect(result).toMatchObject({
        environment: 'production',
        files: EXPORT_FILES.length + 1,
        projectRef: productionRef,
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].command).toBe('psql');
      expect(calls[0].args.join(' ')).not.toContain(secret);
      expect(calls[0].options.input).not.toContain(secret);
      expect(calls[0].options.env.PGPASSWORD).toBe(secret);
      expect(calls[0].options.env.PGSSLMODE).toBe('verify-full');
      expect(calls[0].options.env.PGSSLROOTCERT).toBe(sslRootCertificatePath);
      expect(calls[0].options.env).not.toHaveProperty('NODE_OPTIONS');
      expect(calls[0].options.env).not.toHaveProperty('PGHOSTADDR');
      expect(calls[0].options.env).not.toHaveProperty('SUPABASE_API_URL');
      expect(calls[0].options.timeout).toBe(6 * 60 * 1000);
      for (const filename of EXPORT_FILES) {
        expect(lstatSync(join(directory, filename)).mode & 0o777).toBe(0o600);
      }
      const digestIndex = readFileSync(join(directory, EXPORT_DIGEST_INDEX), 'utf8');
      expect(digestIndex.trim().split('\n')).toHaveLength(EXPORT_FILES.length);
      expect(result.exportSetSha256).toBe(
        createHash('sha256').update(digestIndex).digest('hex'),
      );
      expect(lstatSync(join(directory, EXPORT_DIGEST_INDEX)).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects staging, permissive directories, and reused output paths', () => {
    const directory = protectedDirectory();
    try {
      expect(() => runProductionReviewExport(directory, {
        env: {
          ...productionEnv,
          SUPABASE_DB_URL:
            'postgresql://postgres:secret@db.ewbtkrytrnerypdkuimd.supabase.co:5432/postgres',
          YLL_EXPECTED_SUPABASE_PROJECT_REF: 'ewbtkrytrnerypdkuimd',
          YLL_MIGRATION_ENVIRONMENT: 'staging',
        },
        spawn: mockSuccessfulPsql([]),
      })).toThrow(/only the frozen production target/);

      chmodSync(directory, 0o755);
      expect(() => runProductionReviewExport(directory, {
        env: productionEnv,
        spawn: mockSuccessfulPsql([]),
      })).toThrow(/no group or other access/);

      chmodSync(directory, 0o700);
      writeFileSync(join(directory, EXPORT_FILES[0]), 'existing');
      expect(() => runProductionReviewExport(directory, {
        env: productionEnv,
        spawn: mockSuccessfulPsql([]),
      })).toThrow(/must be empty/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('suppresses child output and connection details on failure', () => {
    const directory = protectedDirectory();
    try {
      let message = '';
      try {
        runProductionReviewExport(directory, {
          env: productionEnv,
          spawn: () => ({ status: 1, stdout: secret, stderr: secret }),
        });
      } catch (error) {
        message = String(error);
      }
      expect(message).toContain('child output is suppressed');
      expect(message).not.toContain(secret);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('requires the paused B2 export set to match the authorized digest', () => {
    const firstDirectory = protectedDirectory();
    const matchingDirectory = protectedDirectory();
    const changedDirectory = protectedDirectory();
    const invalidDirectory = protectedDirectory();
    try {
      const first = runProductionReviewExport(firstDirectory, {
        env: productionEnv,
        spawn: mockSuccessfulPsql([]),
      });
      expect(() => runProductionReviewExport(matchingDirectory, {
        env: productionEnv,
        expectedExportSetSha256: first.exportSetSha256,
        spawn: mockSuccessfulPsql([]),
      })).not.toThrow();

      expect(() => runProductionReviewExport(changedDirectory, {
        env: productionEnv,
        expectedExportSetSha256: 'a'.repeat(64),
        spawn: mockSuccessfulPsql([]),
      })).toThrow(/does not match the authorized SHA-256/);
      expect(() => runProductionReviewExport(invalidDirectory, {
        env: productionEnv,
        expectedExportSetSha256: 'INVALID',
        spawn: mockSuccessfulPsql([]),
      })).toThrow(/64 lowercase hex/);
    } finally {
      rmSync(firstDirectory, { recursive: true, force: true });
      rmSync(matchingDirectory, { recursive: true, force: true });
      rmSync(changedDirectory, { recursive: true, force: true });
      rmSync(invalidDirectory, { recursive: true, force: true });
    }
  });
});
