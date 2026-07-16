// Coverage for the sync-window math the nightly cron and /api/recordings
// /continue both rely on.

import { describe, it, expect } from 'vitest';
import { resolveSyncWindowStart } from './sync';

describe('resolveSyncWindowStart', () => {
  it('defaults to 7 days back on the first run (no stored last_synced_at)', () => {
    const now = new Date('2026-07-14T12:00:00.000Z');
    expect(resolveSyncWindowStart(null, now)).toBe('2026-07-07T12:00:00.000Z');
  });

  it('uses the stored last_synced_at on every later run, ignoring `now`', () => {
    const now = new Date('2026-07-14T12:00:00.000Z');
    expect(resolveSyncWindowStart('2026-07-13T03:00:00.000Z', now)).toBe('2026-07-13T03:00:00.000Z');
  });
});
