import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase';
import { actorResolutionStatus, resolveCurrentHubActor } from '@/lib/auth/resource';
import { hasCapability } from '@/lib/auth/capabilities';
import {
  databaseErrorCode,
  isTaskSchemaUnavailable,
  readIdempotencyKey,
  taskError,
} from './taskRequest';

const TASK_SELECT = 'id,title,detail,status,due_at,created_at,blocked_reason';

interface TaskRow {
  id: string;
  title: string;
  detail: string | null;
  status: 'open' | 'blocked';
  due_at: string;
  created_at: string;
  blocked_reason: string | null;
}

function taskResponse(row: TaskRow) {
  return {
    id: row.id,
    title: row.title,
    detail: row.detail,
    status: row.status,
    dueAt: row.due_at,
    createdAt: row.created_at,
    blockedReason: row.blocked_reason,
  };
}

export async function GET() {
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

  const client = getSupabaseServerClient();
  if (!client) {
    return taskError(
      'TASK_ACCESS_UNAVAILABLE',
      'Task access is temporarily unavailable.',
      503,
      { retryAfter: 60 },
    );
  }

  const { data, error } = await client
    .from('ops_tasks')
    .select(TASK_SELECT)
    .eq('source_system', 'manual')
    .or(
      `created_by_employee_id.eq.${resolution.actor.employeeId},assigned_employee_id.eq.${resolution.actor.employeeId}`,
    )
    .in('status', ['open', 'blocked'])
    .order('due_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    return isTaskSchemaUnavailable(error)
      ? taskError(
          'TASKS_NOT_READY',
          'Manual Hub tasks are not available in this environment yet.',
          503,
          { retryAfter: 60 },
        )
      : taskError('TASKS_UNAVAILABLE', 'Tasks could not be loaded.', 500);
  }

  const tasks = (data ?? []).map(row => taskResponse(row as TaskRow));
  const response = NextResponse.json({ tasks });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function POST(request: NextRequest) {
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
      'A valid idempotency key is required for task creation.',
      400,
    );
  }

  const body = await request.json().catch(() => null) as {
    title?: unknown;
    detail?: unknown;
    dueAt?: unknown;
  } | null;
  if (!body || typeof body.title !== 'string') {
    return taskError('INVALID_TASK', 'Enter a task title.', 400);
  }

  const title = body.title.trim();
  if (!title || title.length > 200) {
    return taskError('INVALID_TASK', 'Task titles must be between 1 and 200 characters.', 400);
  }
  if (body.detail !== undefined && body.detail !== null && typeof body.detail !== 'string') {
    return taskError('INVALID_TASK', 'Task details must be text.', 400);
  }
  const detail = typeof body.detail === 'string' ? body.detail.trim() || null : null;
  if (detail && detail.length > 2000) {
    return taskError('INVALID_TASK', 'Task details cannot exceed 2,000 characters.', 400);
  }

  let dueAt: string | null = null;
  if (body.dueAt !== undefined && body.dueAt !== null && body.dueAt !== '') {
    if (typeof body.dueAt !== 'string') {
      return taskError('INVALID_DUE_AT', 'Choose a valid future due time.', 400);
    }
    const dueDate = new Date(body.dueAt);
    if (Number.isNaN(dueDate.getTime()) || dueDate.getTime() <= Date.now()) {
      return taskError('INVALID_DUE_AT', 'Choose a valid future due time.', 400);
    }
    dueAt = dueDate.toISOString();
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

  const { data, error } = await client.rpc('ops_create_manual_task', {
    p_title: title,
    p_detail: detail,
    p_due_at: dueAt,
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
    if (code === '42501') {
      return taskError('TASK_ACCESS_DENIED', 'You do not have access to create this task.', 403);
    }
    if (code === '22023' || code === '23502' || code === '23514') {
      return taskError('INVALID_TASK', 'The task could not be created from those details.', 400);
    }
    return taskError('TASK_CREATE_FAILED', 'The task could not be saved.', 500);
  }

  const response = NextResponse.json({ taskId: data }, { status: 201 });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
