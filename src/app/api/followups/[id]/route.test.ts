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

import { PUT } from './route';

describe('PUT /api/followups/[id] resource authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCurrentHubActor.mockResolvedValue({ status: 'resolved', actor: { email: 'rep@example.com' } });
    mocks.authorizeCallResource.mockResolvedValue({ status: 'denied' });
  });

  it('does not edit a draft owned by another employee', async () => {
    const update = vi.fn();
    const from = vi.fn(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: 'followup-1', call_id: 'call-other', status: 'draft' },
            error: null,
          }),
        }),
      }),
      update,
    }));
    mocks.getSupabaseServerClient.mockReturnValue({ from });
    const response = await PUT(new Request('https://ops.example.com/api/followups/followup-1', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'changed' }),
    }), { params: Promise.resolve({ id: 'followup-1' }) });

    expect(response.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });
});
