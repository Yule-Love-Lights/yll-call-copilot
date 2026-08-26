import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseServerClient: mocks.getSupabaseServerClient,
  isMissingTableError: () => false,
  isSupabaseConfigured: () => true,
}));

import { GET } from './route';

function database() {
  const from = vi.fn((table: string) => {
    if (table === 'recording_sync_state') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { last_synced_at: '2026-08-08T18:48:00.000Z' }, error: null }),
          }),
        }),
      };
    }
    if (table === 'call_recordings') {
      return {
        select: () => ({
          order: () => ({
            limit: async () => ({ data: [], error: null }),
          }),
          then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
  return { from };
}

afterEach(() => {
  delete process.env.CRON_ENABLED;
  vi.clearAllMocks();
});

describe('GET /api/recordings', () => {
  it.each([['false', false], [undefined, false], ['true', true]])(
    'reports automated sync as %s only when explicitly enabled',
    async (cronEnabled, expected) => {
      if (cronEnabled === undefined) delete process.env.CRON_ENABLED;
      else process.env.CRON_ENABLED = cronEnabled;
      mocks.getSupabaseServerClient.mockReturnValue(database());

      const response = await GET();

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        automatedSyncEnabled: expected,
        lastSyncedAt: '2026-08-08T18:48:00.000Z',
        counts: { pending: 0, processing: 0, transcribed: 0, skipped: 0, failed: 0 },
      });
    },
  );
});
