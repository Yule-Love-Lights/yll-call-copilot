import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildReleaseScripts, parseIdFile } from './prepare-0020-recording-release.mjs';

const canary = readFileSync('supabase/tests/migration/0020_recording_canary_ids.csv', 'utf8');
const remainder = readFileSync('supabase/tests/migration/0020_recording_remainder_ids.csv', 'utf8');

describe('prepare-0020-recording-release', () => {
  it('embeds exact reviewed IDs into directly executable COPY FROM STDIN blocks', () => {
    const scripts = buildReleaseScripts(canary, remainder);
    for (const sql of Object.values(scripts)) {
      expect(sql).not.toContain('__REVIEWED_');
      expect(sql).not.toContain('\\copy');
      expect(sql).toContain('copy reviewed_canary_ids(id) from stdin;');
      expect(sql).toContain('copy reviewed_remainder_ids(id) from stdin;');
      for (const id of canary.trim().split('\n')) expect(sql).toContain(`${id}\n`);
      for (const id of remainder.trim().split('\n')) expect(sql).toContain(`${id}\n`);
    }
  });

  it('requires exact counts, canonical UUIDs, one newline, sorting, and uniqueness', () => {
    expect(() => parseIdFile(canary.trimEnd(), 'canary', 3)).toThrow(/newline/);
    expect(() => parseIdFile(`${canary}bad\n`, 'canary', 3)).toThrow(/exactly 3/);
    expect(() => parseIdFile(canary.replace('71000000', 'NOTUUID-'), 'canary', 3)).toThrow(
      /canonical/,
    );
    const rows = canary.trim().split('\n');
    expect(() => parseIdFile(`${rows[1]}\n${rows[0]}\n${rows[2]}\n`, 'canary', 3)).toThrow(
      /sorted/,
    );
    expect(() => parseIdFile(`${rows[0]}\n${rows[0]}\n${rows[2]}\n`, 'canary', 3)).toThrow(
      /duplicate/,
    );
  });

  it('rejects overlap between the reviewed batches', () => {
    const firstRemainder = remainder.trim().split('\n')[0];
    const overlapCanary = canary.replace(canary.trim().split('\n')[2], firstRemainder);
    expect(() => buildReleaseScripts(overlapCanary, remainder)).toThrow(/overlap/);
  });
});
