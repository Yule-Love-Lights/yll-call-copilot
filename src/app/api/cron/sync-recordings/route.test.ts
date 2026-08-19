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

function fakeSupabase(opts: {
  lastSyncedAt?: string | null;
  callRecordingError?: { message: string } | null;
  storedCursor?: string;
} = {}) {
  const syncStateUpserts: Record<string, unknown>[] = [];
  const from = vi.fn((table: string) => {
    if (table === 'recording_sync_state') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { last_synced_at: opts.lastSyncedAt ?? null }, error: null }),
          }),
        }),
      };
    }
    if (table === 'call_recordings') {
      return {
        upsert: () => ({ select: async () => ({ data: [], error: opts.callRecordingError ?? null }) }),
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });
  const rpc = vi.fn((_fn: string, args: Record<string, unknown>) => {
    syncStateUpserts.push({
      last_synced_at: args.p_next_cursor,
      detail: args.p_detail,
    });
    return Promise.resolve({ data: opts.storedCursor ?? args.p_next_cursor, error: null });
  });
  return { client: { from, rpc }, syncStateUpserts, rpc };
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

  it('pins the provider export end before the fetch and retains its visibility overlap', async () => {
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
      return { messages: [], truncated: false, stopReason: 'window_exhausted', nextSince: null };
    });

    const res = await GET(
      new Request('https://ops.example.com/api/cron/sync-recordings', {
        headers: { authorization: 'Bearer test-cron-secret-value' },
      }),
    );
    const json = await res.json();

    expect(json.ran).toBe(true);
    expect(syncStateUpserts).toHaveLength(1);
    expect(listRecentCallRecordingsMock).toHaveBeenCalledWith(
      '2026-07-13T12:00:00.000Z',
      500,
      '2026-07-14T12:00:00.000Z',
    );
    expect(syncStateUpserts[0].last_synced_at).toBe('2026-07-13T12:00:00.000Z');
  });

  // Measured against the real 2026-08-08 backlog: 129 calls in the window, a
  // fetch capped at 100, and the cursor stamped to now regardless -- which
  // would have silently dropped 29 real sales calls on the very run meant to
  // recover them, while the response read {ran:true, inserted:100}.
  it('advances only to the fetcher-provided safe boundary when an oldest-first page is truncated', async () => {
    const { client, syncStateUpserts } = fakeSupabase({ lastSyncedAt: '2026-08-08T01:05:50.000Z' });
    getSupabaseServerClientMock.mockReturnValue(client);
    listRecentCallRecordingsMock.mockResolvedValue({
      messages: [
        { messageId: 'm-new', conversationId: 'c1', contactId: null, userId: null, direction: 'inbound', dateAdded: '2026-08-15T17:31:07.000Z', durationSeconds: 60 },
        { messageId: 'm-old', conversationId: 'c2', contactId: null, userId: null, direction: 'inbound', dateAdded: '2026-08-08T14:02:07.000Z', durationSeconds: 60 },
      ],
      truncated: true,
      stopReason: 'result_limit',
      nextSince: '2026-08-08T14:02:07.001Z',
    });

    const res = await GET(
      new Request('https://ops.example.com/api/cron/sync-recordings', {
        headers: { authorization: 'Bearer test-cron-secret-value' },
      }),
    );
    const json = await res.json();

    expect(json.ran).toBe(true);
    expect(json.truncated).toBe(true);
    expect(json.cursorHeld).toBe(false);
    expect(syncStateUpserts[0].last_synced_at).toBe('2026-08-08T14:02:07.001Z');
  });

  it('holds the original cursor when a truncated provider result has no proven continuation', async () => {
    const originalCursor = '2026-08-08T01:05:50.000Z';
    const { client, syncStateUpserts } = fakeSupabase({ lastSyncedAt: originalCursor });
    getSupabaseServerClientMock.mockReturnValue(client);
    listRecentCallRecordingsMock.mockResolvedValue({
      messages: [],
      truncated: true,
      stopReason: 'provider_page_cap',
      nextSince: null,
    });

    const res = await GET(
      new Request('https://ops.example.com/api/cron/sync-recordings', {
        headers: { authorization: 'Bearer test-cron-secret-value' },
      }),
    );
    const json = await res.json();

    expect(json.truncated).toBe(true);
    expect(json.cursorHeld).toBe(true);
    expect(syncStateUpserts[0].last_synced_at).toBe(originalCursor);
  });

  it('advances the cursor normally when the window was exhausted', async () => {
    const { client, syncStateUpserts } = fakeSupabase({ lastSyncedAt: '2026-08-08T01:05:50.000Z' });
    getSupabaseServerClientMock.mockReturnValue(client);
    listRecentCallRecordingsMock.mockResolvedValue({
      messages: [
        { messageId: 'm1', conversationId: 'c1', contactId: null, userId: null, direction: 'inbound', dateAdded: '2026-08-15T17:31:07.000Z', durationSeconds: 60 },
      ],
      truncated: false,
      stopReason: 'window_exhausted',
      nextSince: null,
    });

    const res = await GET(
      new Request('https://ops.example.com/api/cron/sync-recordings', {
        headers: { authorization: 'Bearer test-cron-secret-value' },
      }),
    );
    const json = await res.json();

    expect(json.truncated).toBe(false);
    expect(json.cursorHeld).toBe(false);
    expect(syncStateUpserts[0].last_synced_at).not.toBe('2026-08-08T01:05:50.000Z');
  });

  it('holds the original cursor when any recording upsert fails so the call is retried instead of skipped', async () => {
    const originalCursor = '2026-08-08T01:05:50.000Z';
    const { client, syncStateUpserts } = fakeSupabase({
      lastSyncedAt: originalCursor,
      callRecordingError: { message: 'temporary database error' },
    });
    getSupabaseServerClientMock.mockReturnValue(client);
    listRecentCallRecordingsMock.mockResolvedValue({
      messages: [
        { messageId: 'm1', conversationId: 'c1', contactId: null, userId: null, direction: 'inbound', dateAdded: '2026-08-15T17:31:07.000Z', durationSeconds: 60 },
      ],
      truncated: false,
      stopReason: 'window_exhausted',
      nextSince: null,
    });

    const res = await GET(
      new Request('https://ops.example.com/api/cron/sync-recordings', {
        headers: { authorization: 'Bearer test-cron-secret-value' },
      }),
    );
    const json = await res.json();

    expect(json.upsertFailed).toBe(1);
    expect(json.cursorHeld).toBe(true);
    expect(syncStateUpserts[0].last_synced_at).toBe(originalCursor);
  });

  it('uses the database-returned monotonic cursor when an overlapping run already advanced farther', async () => {
    const originalCursor = '2026-08-08T01:05:50.000Z';
    const newerStoredCursor = '2026-08-15T12:00:00.000Z';
    const { client, rpc } = fakeSupabase({ lastSyncedAt: originalCursor, storedCursor: newerStoredCursor });
    getSupabaseServerClientMock.mockReturnValue(client);
    listRecentCallRecordingsMock.mockResolvedValue({
      messages: [],
      truncated: true,
      stopReason: 'provider_page_cap',
      nextSince: '2026-08-10T00:00:00.000Z',
    });

    const res = await GET(new Request('https://ops.example.com/api/cron/sync-recordings', {
      headers: { authorization: 'Bearer test-cron-secret-value' },
    }));
    const json = await res.json();

    expect(rpc).toHaveBeenCalledWith('advance_recording_sync_cursor', expect.objectContaining({
      p_next_cursor: '2026-08-10T00:00:00.000Z',
    }));
    expect(json.cursorHeld).toBe(false);
  });
});
