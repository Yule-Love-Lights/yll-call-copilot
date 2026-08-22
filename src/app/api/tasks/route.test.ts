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

import { GET, POST } from './route';

const EMPLOYEE_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const IDEMPOTENCY_KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actor = {
  employeeId: EMPLOYEE_ID,
  capabilities: ['office.tasks.work'],
};

function postRequest(body: unknown, key?: string): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (key) headers.set('x-idempotency-key', key);
  return new NextRequest('https://ops.example.com/api/tasks', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function getDatabase(result: { data: unknown; error: unknown }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.or = vi.fn(() => query);
  query.in = vi.fn(() => query);
  query.order = vi.fn(() => query);
  Object.assign(query, {
    then: (resolve: (value: unknown) => unknown) => resolve(result),
  });
  const from = vi.fn(() => query);
  return { client: { from }, from, query };
}

describe('/api/tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCurrentHubActor.mockResolvedValue({ status: 'resolved', actor });
  });

  it('lists only the actor\'s manual open and blocked tasks in due order', async () => {
    const rows = [{
      id: TASK_ID,
      title: 'Confirm office supply order',
      status: 'open',
      source_system: 'manual',
    }];
    const database = getDatabase({ data: rows, error: null });
    mocks.getSupabaseServerClient.mockReturnValue(database.client);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      tasks: [{
        id: TASK_ID,
        title: 'Confirm office supply order',
        status: 'open',
      }],
    });
    expect(database.from).toHaveBeenCalledWith('ops_tasks');
    expect(database.query.eq).toHaveBeenCalledWith('source_system', 'manual');
    expect(database.query.or).toHaveBeenCalledWith(
      `created_by_employee_id.eq.${EMPLOYEE_ID},assigned_employee_id.eq.${EMPLOYEE_ID}`,
    );
    expect(database.query.in).toHaveBeenCalledWith('status', ['open', 'blocked']);
    expect(database.query.order).toHaveBeenCalledWith('due_at', { ascending: true });
    expect(database.query.order).toHaveBeenCalledWith('id', { ascending: true });
  });

  it('rejects manual creation without a valid idempotency key', async () => {
    const rpc = vi.fn();
    mocks.getSupabaseServerClient.mockReturnValue({ rpc });

    const response = await POST(postRequest({ title: 'Confirm permit pickup' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'IDEMPOTENCY_KEY_REQUIRED' },
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('maps a valid manual task payload to a self-owned idempotent RPC', async () => {
    const rpc = vi.fn(async () => ({ data: TASK_ID, error: null }));
    mocks.getSupabaseServerClient.mockReturnValue({ rpc });
    const dueAt = '2099-08-22T14:00:00.000Z';

    const response = await POST(postRequest({
      title: 'Confirm permit pickup',
      detail: 'Ask for the printed packet',
      dueAt,
    }, IDEMPOTENCY_KEY));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ taskId: TASK_ID });
    expect(rpc).toHaveBeenCalledWith('ops_create_manual_task', {
      p_title: 'Confirm permit pickup',
      p_detail: 'Ask for the printed packet',
      p_due_at: dueAt,
      p_actor_employee_id: EMPLOYEE_ID,
      p_idempotency_key: IDEMPOTENCY_KEY,
    });
    const rpcCall = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(rpcCall[1]).not.toHaveProperty('p_assigned_employee_id');
  });

  it('lets the database resolve an exact replay after its explicit due time passes', async () => {
    const rpc = vi.fn(async () => ({ data: TASK_ID, error: null }));
    mocks.getSupabaseServerClient.mockReturnValue({ rpc });
    const expiredDueAt = '2020-08-22T14:00:00.000Z';

    const response = await POST(postRequest({
      title: 'Confirm permit pickup',
      dueAt: expiredDueAt,
    }, IDEMPOTENCY_KEY));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ taskId: TASK_ID });
    expect(rpc).toHaveBeenCalledWith('ops_create_manual_task', {
      p_title: 'Confirm permit pickup',
      p_detail: null,
      p_due_at: expiredDueAt,
      p_actor_employee_id: EMPLOYEE_ID,
      p_idempotency_key: IDEMPOTENCY_KEY,
    });
  });

  it('reports an unexpected database failure as a server error', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: 'XX000', message: 'internal database error' },
    }));
    mocks.getSupabaseServerClient.mockReturnValue({ rpc });

    const response = await POST(postRequest(
      { title: 'Confirm permit pickup' },
      IDEMPOTENCY_KEY,
    ));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: 'TASK_CREATE_FAILED',
        message: 'The task could not be saved.',
      },
    });
  });
});
