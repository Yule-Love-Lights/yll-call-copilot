import { describe, expect, it } from 'vitest';

import {
  EXPECTED_MIGRATION_SHA256,
  EXPECTED_PREAMBLE_SHA256,
  IDENTITY_MANIFEST_HEADER,
  MIGRATIONS,
  build,
  buildDashboard,
  buildDashboardDigestBound,
  loadMigrations,
  parseIdentityManifest,
  parseManifest,
} from './prepare-0020-hosted-apply.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const entries = loadMigrations();
const emptyManifest = 'artifact_class,id\n';
const emptyIdentityManifest = `${IDENTITY_MANIFEST_HEADER}\n`;
const validIdentityManifest =
  `${IDENTITY_MANIFEST_HEADER}\n` +
  '81000000-0000-0000-0000-000000000001,' +
  '6f776e6572406578616d706c652e636f6d,' +
  'owner,owner,1724198400.123456,' +
  '91000000-0000-0000-0000-000000000001\n';

describe('prepare-0020-hosted-apply', () => {
  it('wraps canonical 0020-0024 in one transaction and preserves their order', () => {
    const out = build(entries, emptyManifest, emptyIdentityManifest);
    expect(out.match(/^begin;$/gm)).toHaveLength(1);
    expect(out.match(/^commit;$/gm)).toHaveLength(1);

    let previous = -1;
    for (const [version, filename] of MIGRATIONS) {
      const marker = `-- BEGIN canonical migration ${version}: ${filename}`;
      const at = out.indexOf(marker);
      expect(at).toBeGreaterThan(previous);
      previous = at;
    }
  });

  it('renders a dashboard-compatible atomic driver without psql meta-commands or COPY stdin', () => {
    const out = buildDashboard(entries, emptyManifest, validIdentityManifest);
    expect(out.match(/^begin;$/gm)).toHaveLength(1);
    expect(out.match(/^commit;$/gm)).toHaveLength(1);
    expect(out.startsWith('\\set ON_ERROR_STOP')).toBe(false);
    expect(out).not.toMatch(/^\\(?:set|\.)/m);
    expect(out).not.toContain('from stdin');
    expect(out).not.toContain('\\\\.');
    expect(out).toContain('insert into reviewed_identity_backfill');
    expect(out).toContain('insert into reviewed_metric_artifacts');
    for (const [version, filename] of MIGRATIONS) {
      expect(out).toContain(`-- BEGIN canonical migration ${version}: ${filename}`);
    }
  });

  it('binds a dashboard driver to aggregate-only identity and artifact digests', () => {
    const out = buildDashboardDigestBound(entries, {
      identityCount: 2,
      identityDigest: 'a'.repeat(64),
      artifactDigest: 'b'.repeat(64),
      artifactCounts: {
        brain_review: 9,
        edited_playbook_version: 0,
        orphan_call_score: 0,
        playbook_proposal: 14,
        unsafe_personal_touch: 0,
        weekly_digest: 5,
      },
    });
    expect(out.startsWith('\\set ON_ERROR_STOP')).toBe(false);
    expect(out).not.toMatch(/^\\(?:set|\.)/m);
    expect(out).not.toContain('from stdin');
    expect(out).not.toContain('\\\\.');
    expect(out).toContain('Dashboard identity mapping digest mismatch');
    expect(out).toContain('Dashboard artifact manifest digest or count mismatch');
    expect(out).toContain("<> 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'");
    expect(out).toContain("<> 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'");
    expect(() => buildDashboardDigestBound(entries, {
      identityCount: -1,
      identityDigest: 'a'.repeat(64),
      artifactDigest: 'b'.repeat(64),
      artifactCounts: {},
    })).toThrow(/identity count/);
  });

  it('keeps every canonical migration body byte-for-byte inside its section', () => {
    const out = build(entries, emptyManifest, emptyIdentityManifest);
    for (const entry of entries) {
      expect(entry.sql.endsWith('\n')).toBe(true);
      expect(out).toContain(
        `-- BEGIN canonical migration ${entry.version}: ${entry.filename}\n` +
          entry.sql +
          `-- END canonical migration ${entry.version}: ${entry.filename}`,
      );
    }
  });

  it('binds every migration and the reconciliation preamble to reviewed SHA-256 values', () => {
    for (const entry of entries) {
      expect(createHash('sha256').update(entry.sql).digest('hex')).toBe(
        EXPECTED_MIGRATION_SHA256[entry.version],
      );
    }
    const preamble = readFileSync(
      new URL('./sql/0020_historical_reconciliation_preamble.sql', import.meta.url),
      'utf8',
    );
    expect(createHash('sha256').update(preamble).digest('hex')).toBe(
      EXPECTED_PREAMBLE_SHA256,
    );

    const changed = entries.map(entry => ({ ...entry }));
    changed[4].sql = changed[4].sql.replace('commitment', 'changed_commitment');
    expect(() => build(changed, emptyManifest, emptyIdentityManifest)).toThrow(/SHA-256/);
    expect(() =>
      build(entries, emptyManifest, emptyIdentityManifest, `${preamble}\n-- changed\n`),
    ).toThrow(/SHA-256/);
  });

  it('keeps every canonical 0020 preflight and assertion armed', () => {
    const out = build(entries, emptyManifest, emptyIdentityManifest);
    expect(out).toContain('do $legacy_metric_artifact_preflight$');
    expect(out).toContain('do $legacy_personal_touch_provenance_preflight$');
    expect(out).toContain('create function public.assert_legacy_metric_artifacts_reconciled()');
    expect(out).not.toContain('HOSTED-ROLLOUT VARIANT');
  });

  it('bounds the advisory wait and locks both identity sources before backfill', () => {
    const out = build(entries, emptyManifest, emptyIdentityManifest);
    expect(out.indexOf("set local lock_timeout = '5s';")).toBeLessThan(
      out.indexOf('select pg_advisory_xact_lock(202608200020);'),
    );
    expect(out.indexOf("set local statement_timeout = '60s';")).toBeLessThan(
      out.indexOf('select pg_advisory_xact_lock(202608200020);'),
    );
    expect(out).toMatch(/lock table[\s\S]*public\.app_users,[\s\S]*auth\.users[\s\S]*share row exclusive mode;/);
  });

  it('adds postconditions before commit and leaves migration history untouched', () => {
    const out = build(entries, emptyManifest, emptyIdentityManifest);
    expect(out).toContain('do $hosted_0020_0024_verify$');
    for (const table of [
      'ops_departments',
      'ops_employees',
      'ops_employee_auth_identities',
      'ops_employee_department_memberships',
      'ops_identity_audit_events',
    ]) {
      expect(out).toContain(`'${table}'`);
    }
    expect(out).toContain('perform public.assert_legacy_metric_artifacts_reconciled()');
    expect(out).toContain('perform public.assert_personal_touch_metric_provenance()');
    expect(out).toContain('Migration history is intentionally unchanged');
    expect(out).not.toMatch(/insert\s+into\s+supabase_migrations/i);
    expect(out.indexOf('do $hosted_0020_0024_verify$')).toBeLessThan(out.indexOf('\ncommit;'));
  });

  it('refuses missing, reordered, or renamed migrations', () => {
    expect(() => build(entries.slice(0, -1), emptyManifest, emptyIdentityManifest)).toThrow(
      /expected 5 migrations/,
    );
    expect(() =>
      build([entries[1], entries[0], ...entries.slice(2)], emptyManifest, emptyIdentityManifest),
    ).toThrow(/migration order mismatch/);
    expect(() =>
      build(
        [{ ...entries[0], filename: '0020_wrong.sql' }, ...entries.slice(1)],
        emptyManifest,
        emptyIdentityManifest,
      ),
    ).toThrow(/migration order mismatch/);
  });

  it('refuses a migration body that introduces transaction control', () => {
    const changed = entries.map(entry => ({ ...entry }));
    changed[2].sql += '\ncommit;\n';
    expect(() => build(changed, emptyManifest, emptyIdentityManifest)).toThrow(
      /contains transaction control/,
    );
  });

  it('refuses to normalize a missing canonical trailing newline', () => {
    const changed = entries.map(entry => ({ ...entry }));
    changed[1].sql = changed[1].sql.slice(0, -1);
    expect(() => build(changed, emptyManifest, emptyIdentityManifest)).toThrow(
      /end with a newline/,
    );
  });

  it('refuses a weakened canonical 0020 source', () => {
    const changed = entries.map(entry => ({ ...entry }));
    changed[0].sql = changed[0].sql.replace('do $legacy_metric_artifact_preflight$', 'do $x$');
    expect(() => build(changed, emptyManifest, emptyIdentityManifest)).toThrow(
      /canonical 0020 guard is absent/,
    );
  });

  it('embeds a strict reviewed manifest before canonical 0020 in the same transaction', () => {
    const manifest =
      'artifact_class,id\n' +
      'brain_review,82000000-0000-0000-0000-000000000001\n' +
      'weekly_digest,81000000-0000-0000-0000-000000000001\n';
    const out = build(entries, manifest, validIdentityManifest);
    expect(out).toContain(manifest.trimEnd());
    expect(out).toContain(validIdentityManifest.trimEnd());
    expect(out).toContain('do $reviewed_identity_guard$');
    expect(out.indexOf('do $reviewed_identity_guard$')).toBeLessThan(
      out.indexOf('-- BEGIN canonical migration 0020'),
    );
    expect(out.indexOf('copy reviewed_metric_artifacts')).toBeLessThan(
      out.indexOf('-- BEGIN canonical migration 0020'),
    );
    expect(out.match(/^begin;$/gm)).toHaveLength(1);
    expect(out.match(/^commit;$/gm)).toHaveLength(1);
  });

  it('rejects malformed, unsupported, duplicate, and unsorted manifest rows', () => {
    expect(() => parseManifest('artifact_class,id')).toThrow(/newline/);
    expect(() => parseManifest('wrong,id\n')).toThrow(/header/);
    expect(() =>
      parseManifest('artifact_class,id\nunknown,81000000-0000-0000-0000-000000000001\n'),
    ).toThrow(/class/);
    expect(() =>
      parseManifest('artifact_class,id\nweekly_digest,NOT-A-UUID\n'),
    ).toThrow(/UUID/);
    expect(() =>
      parseManifest(
        'artifact_class,id\n' +
          'weekly_digest,81000000-0000-0000-0000-000000000001\n' +
          'weekly_digest,81000000-0000-0000-0000-000000000001\n',
      ),
    ).toThrow(/duplicate/);
    expect(() =>
      parseManifest(
        'artifact_class,id\n' +
          'weekly_digest,81000000-0000-0000-0000-000000000001\n' +
          'brain_review,82000000-0000-0000-0000-000000000001\n',
      ),
    ).toThrow(/sorted/);
  });

  it('parses a strict identity manifest and rejects malformed identity evidence', () => {
    expect(parseIdentityManifest(validIdentityManifest)).toHaveLength(1);
    expect(() => parseIdentityManifest(IDENTITY_MANIFEST_HEADER)).toThrow(/newline/);
    expect(() => parseIdentityManifest(`wrong\n`)).toThrow(/header/);
    expect(() =>
      parseIdentityManifest(
        validIdentityManifest.replace('6f776e6572406578616d706c652e636f6d', 'NOT-HEX'),
      ),
    ).toThrow(/email hex/);
    expect(() =>
      parseIdentityManifest(validIdentityManifest.replace('owner,owner', 'rep,rep')),
    ).toThrow(/backfilled role/);
    expect(() =>
      parseIdentityManifest(validIdentityManifest.replace('1724198400.123456', 'not-an-epoch')),
    ).toThrow(/created-at epoch/);
    expect(() => parseIdentityManifest(validIdentityManifest + '\n')).toThrow(/newline/);
  });

  it('rejects duplicate and unsorted identity mappings', () => {
    const first = validIdentityManifest.slice(IDENTITY_MANIFEST_HEADER.length + 1);
    expect(() => parseIdentityManifest(`${IDENTITY_MANIFEST_HEADER}\n${first}${first}`)).toThrow(
      /duplicate employee/,
    );

    const second = first
      .replace('81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001')
      .replace('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001');
    expect(() => parseIdentityManifest(`${IDENTITY_MANIFEST_HEADER}\n${first}${second}`)).toThrow(
      /sorted/,
    );
  });
});
