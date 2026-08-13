import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), resolveCurrentHubActor: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  getSupabaseServerClient: () => ({ rpc: mocks.rpc }),
  isSupabaseConfigured: () => true,
  isMissingTableError: () => false,
}));
vi.mock('@/lib/auth/resource', () => ({ resolveCurrentHubActor: mocks.resolveCurrentHubActor }));

import { PUT } from './route';

const ID = '11111111-2222-4333-8444-555555555555';

describe('PUT /api/followups/[id] self ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCurrentHubActor.mockResolvedValue({
      status: 'resolved',
      actor: { employeeId: 'employee-1', email: 'rep@example.com' },
    });
  });

  it.each(['rep', 'admin'])('does not let a %s edit another employee draft', async role => {
    if (role === 'admin') {
      mocks.resolveCurrentHubActor.mockResolvedValue({
        status: 'resolved',
        actor: { employeeId: 'admin-1', email: 'admin@example.com' },
      });
    }
    mocks.rpc.mockResolvedValue({ data: [{ result_code: 'not_owned' }], error: null });
    const response = await PUT(new Request(`https://ops.example.com/api/followups/${ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Customer message' }),
    }), { params: Promise.resolve({ id: ID }) });
    expect(response.status).toBe(403);
  });
});
