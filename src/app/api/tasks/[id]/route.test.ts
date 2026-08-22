import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseServerClient: vi.fn(),
  resolveCurrentHubActor: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseServerClient: mocks.getSupabaseServerClient,
  isMissingTableError: (error: unknown) => {
    const code = typeof error === 'object' && error !== null
      ? (error as { code?: string }).code
      : undefined;
    return code === '42P01' || code === 'PGRST205';
  },
}));

vi.mock('@/lib/auth/resource', () => ({
  resolveCurrentHubActor: mocks.resolveCurrentHubActor,
  actorResolutionStatus: (resolution: { status: string }) => {
    if (resolution.status === 'unavailable') return 503;
    if (resolution.status === 'denied') return 403;
    return null;
  },
}));

import { PATCH } from './route';

const EMPLOYEE_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const IDEMPOTENCY_KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actor = {
  employeeId: EMPLOYEE_ID,
  capabilities: ['office.tasks.work'],
};

function patchRequest(body: unknown, key?: string): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (key) headers.set('x-idempotency-key', key);
  return new NextRequest(`https://ops.example.com/api/tasks/${TASK_ID}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
}

async function patch(body: unknown, options: { id?: string; key?: string } = {}) {
  return PATCH(patchRequest(body, options.key), {
    params: Promise.resolve({ id: options.id ?? TASK_ID }),
  });
}

describe('PATCH /api/tasks/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCurrentHubActor.mockResolvedValue({ status: 'resolved', actor });
  });

  it('rejects a mutation without a valid idempotency key', async () => {
    const rpc = vi.fn();
    mocks.getSupabaseServerClient.mockReturnValue({ rpc });

    const response = await patch({ status: 'completed' });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'IDEMPOTENCY_KEY_REQUIRED' },
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(['blocked', 'dismissed'])('requires a nonblank reason for %s', async status => {
    const rpc = vi.fn();
    mocks.getSupabaseServerClient.mockReturnValue({ rpc });

    const response = await patch({ status, reason: '   ' }, { key: IDEMPOTENCY_KEY });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'TASK_REASON_REQUIRED',
        message: expect.stringMatching(/reason/i),
      },
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a malformed task id before calling the mutation routine', async () => {
    const rpc = vi.fn();
    mocks.getSupabaseServerClient.mockReturnValue({ rpc });

    const response = await patch(
      { status: 'completed' },
      { id: 'not-a-uuid', key: IDEMPOTENCY_KEY },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'TASK_NOT_FOUND' } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('maps a valid task action to the resolved employee and idempotency key', async () => {
    const rpc = vi.fn(async () => ({ data: TASK_ID, error: null }));
    mocks.getSupabaseServerClient.mockReturnValue({ rpc });

    const response = await patch(
      { status: 'blocked', reason: 'Waiting for vendor confirmation' },
      { key: IDEMPOTENCY_KEY },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ taskId: TASK_ID, status: 'blocked' });
    expect(rpc).toHaveBeenCalledWith('ops_update_own_task', {
      p_task_id: TASK_ID,
      p_status: 'blocked',
      p_reason: 'Waiting for vendor confirmation',
      p_actor_employee_id: EMPLOYEE_ID,
      p_idempotency_key: IDEMPOTENCY_KEY,
    });
  });

  it.each([
    {
      name: 'ownership denial',
      databaseError: { code: '42501', message: 'task is not owned by actor' },
      status: 404,
      responseCode: 'TASK_NOT_FOUND',
    },
    {
      name: 'missing task',
      databaseError: { code: '23503', message: 'task does not exist' },
      status: 404,
      responseCode: 'TASK_NOT_FOUND',
    },
    {
      name: 'terminal task conflict',
      databaseError: { code: '22023', message: 'terminal task cannot change' },
      status: 409,
      responseCode: 'TASK_STATE_CONFLICT',
    },
    {
      name: 'idempotency conflict',
      databaseError: { code: '23505', message: 'idempotency key payload conflict' },
      status: 409,
      responseCode: 'IDEMPOTENCY_CONFLICT',
    },
  ])('maps $name to HTTP $status', async ({ databaseError, status, responseCode }) => {
    const rpc = vi.fn(async () => ({ data: null, error: databaseError }));
    mocks.getSupabaseServerClient.mockReturnValue({ rpc });

    const response = await patch(
      { status: 'completed' },
      { key: IDEMPOTENCY_KEY },
    );

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code: responseCode } });
  });
});
