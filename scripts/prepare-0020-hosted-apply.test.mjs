import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { SOURCE, build } from './prepare-0020-hosted-apply.mjs';

const canonical = readFileSync(SOURCE, 'utf8');

describe('prepare-0020-hosted-apply', () => {
  it('drops the legacy-metric-artifact preflight from the real migration', () => {
    const { out } = build(canonical);
    expect(canonical).toContain('do $legacy_metric_artifact_preflight$');
    expect(out).not.toContain('do $legacy_metric_artifact_preflight$');
    expect(out).toContain('HOSTED-ROLLOUT VARIANT');
  });

  it('keeps the personal-touch preflight armed', () => {
    // This gate passes on current data, so removing it would buy nothing and
    // silently drop a real provenance check.
    const { out } = build(canonical);
    expect(out).toContain('do $legacy_personal_touch_provenance_preflight$');
    expect(out).toContain('$legacy_personal_touch_provenance_preflight$;');
  });

  it('keeps the reusable fail-closed assertion function', () => {
    const { out } = build(canonical);
    expect(out).toContain('create function public.assert_legacy_metric_artifacts_reconciled()');
  });

  it('changes nothing outside the removed block', () => {
    const { out } = build(canonical);
    const open = canonical.indexOf('do $legacy_metric_artifact_preflight$');
    const end =
      canonical.indexOf('$legacy_metric_artifact_preflight$;', open) +
      '$legacy_metric_artifact_preflight$;'.length;
    expect(out.startsWith(canonical.slice(0, open))).toBe(true);
    expect(out.endsWith(canonical.slice(end))).toBe(true);
  });

  it('preserves every schema statement byte-for-byte', () => {
    // The removed block is pure plpgsql counting; no DDL may be lost with it.
    const { out } = build(canonical);
    const ddl = text =>
      text
        .split('\n')
        .filter(line => /^\s*(alter|create|drop|revoke|grant|comment|update|insert)\b/i.test(line))
        .join('\n');
    expect(ddl(out)).toBe(ddl(canonical));
  });

  it('refuses a source whose preflight opener is missing', () => {
    expect(() => build('select 1;')).toThrow(/preflight opener not found/);
  });

  it('refuses a source with a duplicated preflight opener', () => {
    expect(() => build(`${canonical}\ndo $legacy_metric_artifact_preflight$`)).toThrow(
      /more than once/,
    );
  });

  it('refuses a source whose preflight is unterminated', () => {
    const truncated = canonical.slice(
      0,
      canonical.indexOf('$legacy_metric_artifact_preflight$;'),
    );
    expect(() => build(truncated)).toThrow(/terminator not found/);
  });

  it('refuses when the personal-touch preflight is already absent', () => {
    const stripped = canonical.replaceAll('$legacy_personal_touch_provenance_preflight$', 'x');
    expect(() => build(stripped)).toThrow(/lost required block/);
  });
});
