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
vi.mock('@/lib/claude', () => ({ isClaudeConfigured: vi.fn(() => false) }));
vi.mock('@/lib/transcripts/process', () => ({ processTranscriptBatch: vi.fn() }));

import { POST } from './route';

describe('POST /api/live/end resource authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCurrentHubActor.mockResolvedValue({ status: 'resolved', actor: { email: 'rep@example.com' } });
    mocks.authorizeCallResource.mockResolvedValue({ status: 'denied' });
  });

  it('does not end another employee live session', async () => {
    const update = vi.fn();
    const from = vi.fn((table: string) => {
      if (table !== 'live_sessions') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: 'session-1', call_id: 'call-other', status: 'active' },
              error: null,
            }),
          }),
        }),
        update,
      };
    });
    mocks.getSupabaseServerClient.mockReturnValue({ from });
    const response = await POST(new Request('https://ops.example.com/api/live/end', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1' }),
    }));

    expect(response.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });
});
