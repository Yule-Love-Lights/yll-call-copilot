import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseServerClient: vi.fn(),
  resolveCurrentHubActor: vi.fn(),
  authorizeCallResource: vi.fn(),
  sendConversationMessage: vi.fn(),
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
vi.mock('@/lib/ghl/client', () => ({
  HighLevelError: class HighLevelError extends Error {},
  isHighLevelConfigured: vi.fn(() => true),
  sendConversationMessage: mocks.sendConversationMessage,
}));

import { POST } from './route';

describe('POST /api/followups/[id]/send resource authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('GHL_SEND_ENABLED', 'true');
    mocks.resolveCurrentHubActor.mockResolvedValue({ status: 'resolved', actor: { email: 'rep@example.com' } });
    mocks.authorizeCallResource.mockResolvedValue({ status: 'denied' });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('does not send a draft owned by another employee', async () => {
    const update = vi.fn();
    const from = vi.fn(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: 'followup-1', call_id: 'call-other', kind: 'sms',
              to_address: '+15551234567', subject: null, body: 'hello', status: 'draft',
            },
            error: null,
          }),
        }),
      }),
      update,
    }));
    mocks.getSupabaseServerClient.mockReturnValue({ from });
    const response = await POST(new Request('https://ops.example.com/api/followups/followup-1/send', { method: 'POST' }), {
      params: Promise.resolve({ id: 'followup-1' }),
    });

    expect(response.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
    expect(mocks.sendConversationMessage).not.toHaveBeenCalled();
  });
});
