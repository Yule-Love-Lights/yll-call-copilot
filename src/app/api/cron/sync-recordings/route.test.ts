// Coverage for the nightly sync cron's cursor bug: last_synced_at must be
// captured BEFORE the GHL fetch runs, not after, or a call whose dateAdded
// lands during the fetch window is skipped forever (the next run's `since`
// is already past it). Every dependency is mocked -- no live GHL/Supabase.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const isSupabaseConfiguredMock = vi.fn();
const getSupabaseServerClientMock = vi.fn();
const isMissingTableErrorMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: (...args: unknown[]) => isSupabaseConfiguredMock(...args),
  getSupabaseServerClient: (...args: unknown[]) => getSupabaseServerClientMock(...args),
  isMissingTableError: (...args: unknown[]) => isMissingTableErrorMock(...args),
}));

const isHighLevelConfiguredMock = vi.fn();
vi.mock('@/lib/ghl/client', () => ({
  isHighLevelConfigured: (...args: unknown[]) => isHighLevelConfiguredMock(...args),
}));

const listRecentCallRecordingsMock = vi.fn();
vi.mock('@/lib/ghl/recordings', () => ({
  listRecentCallRecordings: (...args: unknown[]) => listRecentCallRecordingsMock(...args),
}));

const processPendingRecordingsMock = vi.fn();
vi.mock('@/lib/recordings/pipeline', () => ({
  processPendingRecordings: (...args: unknown[]) => processPendingRecordingsMock(...args),
}));

import { GET } from './route';

function fakeSupabase(opts: { lastSyncedAt?: string | null } = {}) {
  const syncStateUpserts: Record<string, unknown>[] = [];
  const from = vi.fn((table: string) => {
    if (table === 'recording_sync_state') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { last_synced_at: opts.lastSyncedAt ?? null }, error: null }),
          }),
        }),
        upsert: async (row: Record<string, unknown>) => {
          syncStateUpserts.push(row);
          return { error: null };
        },
      };
    }
    if (table === 'call_recordings') {
      return {
        upsert: () => ({ select: async () => ({ data: [], error: null }) }),
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });
  return { client: { from }, syncStateUpserts };
}

describe('GET /api/cron/sync-recordings', () => {
  const originalCronEnabled = process.env.CRON_ENABLED;
  const originalCronSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_ENABLED = 'true';
    process.env.CRON_SECRET = 'test-cron-secret-value';
    isSupabaseConfiguredMock.mockReturnValue(true);
    isHighLevelConfiguredMock.mockReturnValue(true);
    processPendingRecordingsMock.mockReset().mockResolvedValue({ done: 0, skipped: 0, failed: 0 });
    listRecentCallRecordingsMock.mockReset();
  });

  afterEach(() => {
    process.env.CRON_ENABLED = originalCronEnabled;
    process.env.CRON_SECRET = originalCronSecret;
    vi.useRealTimers();
  });

  it('stamps last_synced_at from BEFORE the GHL fetch, not after, so a call added mid-fetch is not skipped next run', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T12:00:00.000Z'));

    const { client, syncStateUpserts } = fakeSupabase({ lastSyncedAt: '2026-07-13T12:00:00.000Z' });
    getSupabaseServerClientMock.mockReturnValue(client);

    // Simulate the fetch taking real wall-clock time: a call landing at
    // 12:00:03 (mid-fetch) must still be inside the window the NEXT run
    // starts from, i.e. last_synced_at must be stamped at 12:00:00, not
    // whenever this mock resolves.
    listRecentCallRecordingsMock.mockImplementation(async () => {
      vi.setSystemTime(new Date('2026-07-14T12:00:05.000Z'));
      return { messages: [], truncated: false };
    });

    const res = await GET(
      new Request('https://ops.example.com/api/cron/sync-recordings', {
        headers: { authorization: 'Bearer test-cron-secret-value' },
      }),
    );
    const json = await res.json();

    expect(json.ran).toBe(true);
    expect(syncStateUpserts).toHaveLength(1);
    expect(syncStateUpserts[0].last_synced_at).toBe('2026-07-14T12:00:00.000Z');
  });

  // Measured against the real 2026-08-08 backlog: 129 calls in the window, a
  // fetch capped at 100, and the cursor stamped to now regardless -- which
  // would have silently dropped 29 real sales calls on the very run meant to
  // recover them, while the response read {ran:true, inserted:100}.
  it('HOLDS the cursor at the oldest returned call when the fetch was truncated', async () => {
    const { client, syncStateUpserts } = fakeSupabase({ lastSyncedAt: '2026-08-08T01:05:50.000Z' });
    getSupabaseServerClientMock.mockReturnValue(client);
    listRecentCallRecordingsMock.mockResolvedValue({
      messages: [
        { messageId: 'm-new', conversationId: 'c1', contactId: null, userId: null, direction: 'inbound', dateAdded: '2026-08-15T17:31:07.000Z', durationSeconds: 60 },
        { messageId: 'm-old', conversationId: 'c2', contactId: null, userId: null, direction: 'inbound', dateAdded: '2026-08-08T14:02:07.000Z', durationSeconds: 60 },
      ],
      truncated: true,
    });

    const res = await GET(
      new Request('https://ops.example.com/api/cron/sync-recordings', {
        headers: { authorization: 'Bearer test-cron-secret-value' },
      }),
    );
    const json = await res.json();

    expect(json.ran).toBe(true);
    expect(json.truncated).toBe(true);
    expect(json.cursorHeld).toBe(true);
    // The OLDEST returned call, never "now" -- so the 29 unfetched calls stay
    // inside the next run's window instead of falling out of it.
    expect(syncStateUpserts[0].last_synced_at).toBe('2026-08-08T14:02:07.000Z');
  });

  it('advances the cursor normally when the window was exhausted', async () => {
    const { client, syncStateUpserts } = fakeSupabase({ lastSyncedAt: '2026-08-08T01:05:50.000Z' });
    getSupabaseServerClientMock.mockReturnValue(client);
    listRecentCallRecordingsMock.mockResolvedValue({
      messages: [
        { messageId: 'm1', conversationId: 'c1', contactId: null, userId: null, direction: 'inbound', dateAdded: '2026-08-15T17:31:07.000Z', durationSeconds: 60 },
      ],
      truncated: false,
    });

    const res = await GET(
      new Request('https://ops.example.com/api/cron/sync-recordings', {
        headers: { authorization: 'Bearer test-cron-secret-value' },
      }),
    );
    const json = await res.json();

    expect(json.truncated).toBe(false);
    expect(json.cursorHeld).toBe(false);
    expect(syncStateUpserts[0].last_synced_at).not.toBe('2026-08-15T17:31:07.000Z');
  });
});
