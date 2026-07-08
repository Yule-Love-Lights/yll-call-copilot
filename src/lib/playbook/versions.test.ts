// Coverage for publishPlaybookVersion — the H6 regression: three routes
// (proposals/[id]/decide, verticals/[id]/generate, verticals/[id]/playbook)
// each did an unguarded read active_version -> compute +1 -> insert
// playbook_versions -> update verticals, so two of them racing on the same
// vertical collide on playbook_versions' unique(vertical_id, version) and
// the loser's insert throws a generic 500, discarding whichever publish
// lost. This is the shared, retrying helper that replaced all three.

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publishPlaybookVersion } from './versions';
import type { Playbook } from './types';

function playbook(icp = 'base'): Playbook {
  return { icp, angles: [], openers: [], objections: [], avoid: [], voicemail: '' };
}

type FakeOpts = {
  activeVersions: number[]; // one value consumed per verticals.select call, last one repeats
  insertErrorCodes?: (string | null)[]; // one entry consumed per playbook_versions.insert call
  updateError?: { message: string } | null;
  verticalMissing?: boolean;
  verticalError?: { message: string } | null;
};

function fakeSupabase(opts: FakeOpts) {
  let versionCallIndex = 0;
  let insertCallIndex = 0;
  const insertedVersions: { vertical_id: string; version: number; content: Playbook; source: string }[] = [];
  const updateCalls: { active_version: number }[] = [];

  const from = vi.fn((table: string) => {
    if (table === 'verticals') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => {
              if (opts.verticalError) return Promise.resolve({ data: null, error: opts.verticalError });
              if (opts.verticalMissing) return Promise.resolve({ data: null, error: null });
              const idx = Math.min(versionCallIndex, opts.activeVersions.length - 1);
              versionCallIndex++;
              return Promise.resolve({ data: { active_version: opts.activeVersions[idx] }, error: null });
            },
          }),
        }),
        update: (row: { active_version: number }) => {
          updateCalls.push(row);
          return { eq: () => Promise.resolve({ error: opts.updateError ?? null }) };
        },
      };
    }
    if (table === 'playbook_versions') {
      return {
        insert: (row: { vertical_id: string; version: number; content: Playbook; source: string }) => {
          const code = (opts.insertErrorCodes ?? [])[insertCallIndex] ?? null;
          insertCallIndex++;
          if (code) return Promise.resolve({ error: { code, message: 'insert failed' } });
          insertedVersions.push(row);
          return Promise.resolve({ error: null });
        },
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return { client: { from } as unknown as SupabaseClient, insertedVersions, updateCalls };
}

describe('publishPlaybookVersion', () => {
  it('publishes version active_version+1 on the happy path', async () => {
    const { client, insertedVersions, updateCalls } = fakeSupabase({ activeVersions: [2] });

    const result = await publishPlaybookVersion(client, 'v1', 'generated', () => ({ ok: true, playbook: playbook() }));

    expect(result).toEqual({ ok: true, version: 3 });
    expect(insertedVersions).toEqual([{ vertical_id: 'v1', version: 3, content: playbook(), source: 'generated' }]);
    expect(updateCalls).toEqual([{ active_version: 3 }]);
  });

  it('retries once, re-reading active_version, when the insert collides on the unique(vertical_id, version) constraint', async () => {
    // First attempt reads active_version=2 (computes version 3) and collides;
    // by the time the retry re-reads, someone else already published version
    // 3, so active_version is now 3 (computes version 4) and succeeds.
    const { client, insertedVersions } = fakeSupabase({
      activeVersions: [2, 3],
      insertErrorCodes: ['23505', null],
    });
    const resolveContent = vi.fn((activeVersion: number) => ({ ok: true as const, playbook: playbook(`v${activeVersion}`) }));

    const result = await publishPlaybookVersion(client, 'v1', 'edited', resolveContent);

    expect(result).toEqual({ ok: true, version: 4 });
    expect(resolveContent).toHaveBeenCalledTimes(2);
    expect(resolveContent).toHaveBeenNthCalledWith(1, 2);
    expect(resolveContent).toHaveBeenNthCalledWith(2, 3); // proves the retry used the FRESHLY re-read version, not stale data
    expect(insertedVersions).toEqual([{ vertical_id: 'v1', version: 4, content: playbook('v3'), source: 'edited' }]);
  });

  it('returns 409 after a second collision (does not retry forever)', async () => {
    const { client } = fakeSupabase({ activeVersions: [2, 3], insertErrorCodes: ['23505', '23505'] });

    const result = await publishPlaybookVersion(client, 'v1', 'edited', () => ({ ok: true, playbook: playbook() }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.reason).toMatch(/same time/i);
    }
  });

  it('returns the resolveContent error immediately, without retrying (not a race, a real business-state failure)', async () => {
    const { client, insertedVersions } = fakeSupabase({ activeVersions: [0] });
    const resolveContent = vi.fn(() => ({ ok: false as const, error: 'This vertical has no active playbook to apply the proposal to.', status: 409 }));

    const result = await publishPlaybookVersion(client, 'v1', 'edited', resolveContent);

    expect(result).toEqual({ ok: false, status: 409, reason: 'This vertical has no active playbook to apply the proposal to.' });
    expect(resolveContent).toHaveBeenCalledTimes(1);
    expect(insertedVersions).toEqual([]);
  });

  it('returns 404 when the vertical does not exist', async () => {
    const { client } = fakeSupabase({ activeVersions: [], verticalMissing: true });

    const result = await publishPlaybookVersion(client, 'missing', 'edited', () => ({ ok: true, playbook: playbook() }));

    expect(result).toEqual({ ok: false, status: 404, reason: 'Vertical not found.' });
  });

  it('returns 500 when loading the vertical errors', async () => {
    const { client } = fakeSupabase({ activeVersions: [], verticalError: { message: 'boom' } });

    const result = await publishPlaybookVersion(client, 'v1', 'edited', () => ({ ok: true, playbook: playbook() }));

    expect(result).toEqual({ ok: false, status: 500, reason: 'Could not load vertical.' });
  });

  it('returns 500 on a non-collision insert error', async () => {
    const { client } = fakeSupabase({ activeVersions: [1], insertErrorCodes: ['42P01'] });

    const result = await publishPlaybookVersion(client, 'v1', 'edited', () => ({ ok: true, playbook: playbook() }));

    expect(result).toEqual({ ok: false, status: 500, reason: 'Could not store the playbook.' });
  });

  it('returns 500 when bumping active_version fails', async () => {
    const { client } = fakeSupabase({ activeVersions: [1], updateError: { message: 'boom' } });

    const result = await publishPlaybookVersion(client, 'v1', 'edited', () => ({ ok: true, playbook: playbook() }));

    expect(result).toEqual({ ok: false, status: 500, reason: 'Could not activate the saved playbook.' });
  });
});
