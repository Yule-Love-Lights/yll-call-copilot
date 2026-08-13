import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), resolveCurrentHubActor: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  getSupabaseServerClient: () => ({ rpc: mocks.rpc }),
  isSupabaseConfigured: () => true,
  isMissingTableError: () => false,
}));
vi.mock('@/lib/auth/resource', () => ({ resolveCurrentHubActor: mocks.resolveCurrentHubActor }));
vi.mock('@/lib/claude', () => ({ isClaudeConfigured: () => false }));
vi.mock('@/lib/transcripts/process', () => ({ processTranscriptBatch: vi.fn() }));

import { POST } from './route';

const SESSION_ID = '11111111-2222-4333-8444-555555555555';

function request() {
  return new Request('https://ops.example.com/api/live/end', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: SESSION_ID }),
  });
}

describe('POST /api/live/end transactional ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCurrentHubActor.mockResolvedValue({
      status: 'resolved',
      actor: { employeeId: 'employee-1', email: 'rep@example.com' },
    });
  });

  it.each(['rep', 'admin'])('does not let a %s end another employee call', async role => {
    if (role === 'admin') {
      mocks.resolveCurrentHubActor.mockResolvedValue({
        status: 'resolved',
        actor: { employeeId: 'admin-1', email: 'admin@example.com' },
      });
    }
    mocks.rpc.mockResolvedValue({ data: [{ result_code: 'not_owned' }], error: null });
    const response = await POST(request());
    expect(response.status).toBe(403);
  });

  it('returns the same call for an idempotent repeat', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        result_code: 'already_ended',
        session_id: SESSION_ID,
        call_id: '21111111-2222-4333-8444-555555555555',
        transcript_id: null,
        status: 'pending_outcome',
        already_ended: true,
      }],
      error: null,
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ saved: true, alreadyEnded: true, status: 'pending_outcome' });
  });
});
