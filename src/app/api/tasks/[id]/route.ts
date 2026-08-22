import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase';
import { actorResolutionStatus, resolveCurrentHubActor } from '@/lib/auth/resource';
import { hasCapability } from '@/lib/auth/capabilities';
import {
  databaseErrorCode,
  isTaskSchemaUnavailable,
  isUuid,
  readIdempotencyKey,
  taskError,
} from '../taskRequest';

type TaskAction = 'blocked' | 'completed' | 'dismissed';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const resolution = await resolveCurrentHubActor();
  const status = actorResolutionStatus(resolution);
  if (status || resolution.status !== 'resolved') {
    return taskError(
      status === 503 ? 'TASK_ACCESS_UNAVAILABLE' : 'TASK_ACCESS_DENIED',
      status === 503
        ? 'Task access is temporarily unavailable.'
        : 'You do not have access to Office tasks.',
      status ?? 403,
      status === 503 ? { retryAfter: 60 } : undefined,
    );
  }
  if (!hasCapability(resolution.actor, 'office.tasks.work')) {
    return taskError('TASK_ACCESS_DENIED', 'You do not have access to Office tasks.', 403);
  }

  const key = readIdempotencyKey(request);
  if (!key) {
    return taskError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'A valid idempotency key is required for task updates.',
      400,
    );
  }

  const { id } = await params;
  if (!isUuid(id)) return taskError('TASK_NOT_FOUND', 'Task not found.', 404);

  const body = await request.json().catch(() => null) as {
    status?: unknown;
    reason?: unknown;
  } | null;
  if (!body || !['blocked', 'completed', 'dismissed'].includes(String(body.status))) {
    return taskError('INVALID_TASK_ACTION', 'Choose a valid task action.', 400);
  }
  if (body.reason !== undefined && body.reason !== null && typeof body.reason !== 'string') {
    return taskError('INVALID_TASK_ACTION', 'Task reasons must be text.', 400);
  }

  const action = body.status as TaskAction;
  const reason = typeof body.reason === 'string' ? body.reason.trim() || null : null;
  if ((action === 'blocked' || action === 'dismissed') && !reason) {
    return taskError(
      'TASK_REASON_REQUIRED',
      action === 'blocked'
        ? 'Enter a reason before blocking this task.'
        : 'Enter a reason before dismissing this task.',
      400,
    );
  }
  if (action === 'completed' && reason) {
    return taskError('INVALID_TASK_ACTION', 'Completed tasks do not accept a reason.', 400);
  }
  if (reason && reason.length > 500) {
    return taskError('INVALID_TASK_ACTION', 'Task reasons cannot exceed 500 characters.', 400);
  }

  const client = getSupabaseServerClient();
  if (!client) {
    return taskError(
      'TASK_ACCESS_UNAVAILABLE',
      'Task access is temporarily unavailable.',
      503,
      { retryAfter: 60 },
    );
  }

  const { data, error } = await client.rpc('ops_update_own_task', {
    p_task_id: id,
    p_status: action,
    p_reason: reason,
    p_actor_employee_id: resolution.actor.employeeId,
    p_idempotency_key: key,
  });

  if (error) {
    if (isTaskSchemaUnavailable(error)) {
      return taskError(
        'TASKS_NOT_READY',
        'Manual Hub tasks are not available in this environment yet.',
        503,
        { retryAfter: 60 },
      );
    }
    const code = databaseErrorCode(error);
    if (code === '23505') {
      return taskError(
        'IDEMPOTENCY_CONFLICT',
        'That request key was already used for a different task action.',
        409,
      );
    }
    if (code === '42501' || code === '23503') {
      return taskError('TASK_NOT_FOUND', 'Task not found.', 404);
    }
    if (code === '22023' || code === '23514') {
      return taskError(
        'TASK_STATE_CONFLICT',
        'This task changed before the action could be saved. Refresh the list and try again.',
        409,
      );
    }
    return taskError('TASK_UPDATE_FAILED', 'The task action could not be saved.', 500);
  }

  const response = NextResponse.json({ taskId: data, status: action });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
