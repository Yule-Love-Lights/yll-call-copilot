import { describe, expect, it } from 'vitest';

import { MIGRATIONS, build, loadMigrations, parseManifest } from './prepare-0020-hosted-apply.mjs';

const entries = loadMigrations();
const emptyManifest = 'artifact_class,id\n';

describe('prepare-0020-hosted-apply', () => {
  it('wraps canonical 0020-0024 in one transaction and preserves their order', () => {
    const out = build(entries, emptyManifest);
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

  it('keeps every canonical migration body byte-for-byte inside its section', () => {
    const out = build(entries, emptyManifest);
    for (const entry of entries) {
      expect(entry.sql.endsWith('\n')).toBe(true);
      expect(out).toContain(
        `-- BEGIN canonical migration ${entry.version}: ${entry.filename}\n` +
          entry.sql +
          `-- END canonical migration ${entry.version}: ${entry.filename}`,
      );
    }
  });

  it('keeps every canonical 0020 preflight and assertion armed', () => {
    const out = build(entries, emptyManifest);
    expect(out).toContain('do $legacy_metric_artifact_preflight$');
    expect(out).toContain('do $legacy_personal_touch_provenance_preflight$');
    expect(out).toContain('create function public.assert_legacy_metric_artifacts_reconciled()');
    expect(out).not.toContain('HOSTED-ROLLOUT VARIANT');
  });

  it('adds postconditions before commit and leaves migration history untouched', () => {
    const out = build(entries, emptyManifest);
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
    expect(() => build(entries.slice(0, -1), emptyManifest)).toThrow(/expected 5 migrations/);
    expect(() => build([entries[1], entries[0], ...entries.slice(2)], emptyManifest)).toThrow(
      /migration order mismatch/,
    );
    expect(() =>
      build([{ ...entries[0], filename: '0020_wrong.sql' }, ...entries.slice(1)], emptyManifest),
    ).toThrow(/migration order mismatch/);
  });

  it('refuses a migration body that introduces transaction control', () => {
    const changed = entries.map(entry => ({ ...entry }));
    changed[2].sql += '\ncommit;\n';
    expect(() => build(changed, emptyManifest)).toThrow(/contains transaction control/);
  });

  it('refuses to normalize a missing canonical trailing newline', () => {
    const changed = entries.map(entry => ({ ...entry }));
    changed[1].sql = changed[1].sql.slice(0, -1);
    expect(() => build(changed, emptyManifest)).toThrow(/end with a newline/);
  });

  it('refuses a weakened canonical 0020 source', () => {
    const changed = entries.map(entry => ({ ...entry }));
    changed[0].sql = changed[0].sql.replace('do $legacy_metric_artifact_preflight$', 'do $x$');
    expect(() => build(changed, emptyManifest)).toThrow(/canonical 0020 guard is absent/);
  });

  it('embeds a strict reviewed manifest before canonical 0020 in the same transaction', () => {
    const manifest =
      'artifact_class,id\n' +
      'brain_review,82000000-0000-0000-0000-000000000001\n' +
      'weekly_digest,81000000-0000-0000-0000-000000000001\n';
    const out = build(entries, manifest);
    expect(out).toContain(manifest.trimEnd());
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
});
