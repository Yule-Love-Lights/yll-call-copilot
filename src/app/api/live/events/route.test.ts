import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseServerClient: vi.fn(),
  resolveCurrentHubActor: vi.fn(),
  authorizeCallResource: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseServerClient: mocks.getSupabaseServerClient,
  isSupabaseConfigured: vi.fn(() => true),
  isMissingTableError: vi.fn(() => false),
}));
vi.mock('@/lib/auth/resource', () => ({
  resolveCurrentHubActor: mocks.resolveCurrentHubActor,
  authorizeCallResource: mocks.authorizeCallResource,
}));

import { GET } from './route';

describe('GET /api/live/events resource authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCurrentHubActor.mockResolvedValue({ status: 'resolved', actor: { email: 'rep@example.com' } });
    mocks.authorizeCallResource.mockResolvedValue({ status: 'denied' });
  });

  it('does not expose another employee live session', async () => {
    const from = vi.fn((table: string) => {
      if (table !== 'live_sessions') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: 'session-1', call_id: 'call-other' },
              error: null,
            }),
          }),
        }),
      };
    });
    mocks.getSupabaseServerClient.mockReturnValue({ from });

    const response = await GET(new Request('https://ops.example.com/api/live/events?sessionId=session-1'));

    expect(response.status).toBe(403);
    expect(mocks.authorizeCallResource).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ callId: 'call-other', resourceId: 'session-1' }),
    );
    expect(from).not.toHaveBeenCalledWith('coaching_events');
  });
});
