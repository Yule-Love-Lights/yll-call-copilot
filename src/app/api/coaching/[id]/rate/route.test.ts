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

import { POST } from './route';

describe('POST /api/coaching/[id]/rate resource authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCurrentHubActor.mockResolvedValue({ status: 'resolved', actor: { email: 'rep@example.com' } });
    mocks.authorizeCallResource.mockResolvedValue({ status: 'denied' });
  });

  it('does not let one rep rate another rep coaching card', async () => {
    const update = vi.fn();
    const from = vi.fn(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: 'event-1', call_id: 'call-other' }, error: null,
          }),
        }),
      }),
      update,
    }));
    mocks.getSupabaseServerClient.mockReturnValue({ from });
    const response = await POST(new Request('https://ops.example.com/api/coaching/event-1/rate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rating: 'helpful' }),
    }), { params: Promise.resolve({ id: 'event-1' }) });

    expect(response.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
    expect(mocks.authorizeCallResource).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ callId: 'call-other', teamCapability: null }),
    );
  });
});
