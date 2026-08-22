'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';

type VisibleTaskStatus = 'open' | 'blocked';
type TaskAction = 'blocked' | 'completed' | 'dismissed';
type LoadState = 'loading' | 'ready' | 'error' | 'unavailable';

interface OfficeTask {
  id: string;
  title: string;
  detail: string | null;
  status: VisibleTaskStatus;
  dueAt: string;
  createdAt: string;
  blockedReason: string | null;
}

interface ActionEditor {
  taskId: string;
  action: 'blocked' | 'dismissed';
  reason: string;
}

interface ApiErrorBody {
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

type TaskLoadResult =
  | { state: 'ready'; tasks: OfficeTask[] }
  | { state: 'error' | 'unavailable'; message: string };

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as ApiErrorBody | null;
  const code = typeof body?.error?.code === 'string' ? body.error.code : null;
  const message = typeof body?.error?.message === 'string' ? body.error.message : fallback;
  return { code, message };
}

function formatDueTime(value: string): string {
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return 'Due time unavailable';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(due);
}

async function requestTasks(): Promise<TaskLoadResult> {
  try {
    const response = await fetch('/api/tasks', { cache: 'no-store' });
    if (!response.ok) {
      const error = await responseError(response, 'Tasks could not be loaded.');
      const unavailable = response.status === 503
        && (error.code === 'TASKS_NOT_READY' || error.code === 'TASK_ACCESS_UNAVAILABLE');
      return { state: unavailable ? 'unavailable' : 'error', message: error.message };
    }

    const body = await response.json() as { tasks?: unknown };
    if (!Array.isArray(body.tasks)) throw new Error('invalid task response');
    return { state: 'ready', tasks: body.tasks as OfficeTask[] };
  } catch {
    return {
      state: 'error',
      message: 'Tasks could not be loaded. Check your connection and try again.',
    };
  }
}

export default function OfficeTasksCard() {
  const [tasks, setTasks] = useState<OfficeTask[] | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadMessage, setLoadMessage] = useState('Loading manual tasks…');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pendingTaskIds, setPendingTaskIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [actionEditor, setActionEditor] = useState<ActionEditor | null>(null);
  const [actionError, setActionError] = useState<{ taskId: string; message: string } | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const loadSequenceRef = useRef(0);
  const creatingRef = useRef(false);
  const createKeyRef = useRef<string | null>(null);
  const pendingTaskIdsRef = useRef(new Set<string>());
  const actionKeysRef = useRef(new Map<string, string>());

  const applyTaskLoad = useCallback((sequence: number, result: TaskLoadResult) => {
    if (sequence !== loadSequenceRef.current) return;
    if (result.state === 'ready') {
      setTasks(result.tasks);
      setLoadState('ready');
      setLoadMessage('');
      return;
    }
    setLoadState(result.state);
    setLoadMessage(result.message);
  }, []);

  const loadTasks = useCallback(async () => {
    const sequence = ++loadSequenceRef.current;
    setLoadState('loading');
    setLoadMessage('Loading manual tasks…');
    applyTaskLoad(sequence, await requestTasks());
  }, [applyTaskLoad]);

  useEffect(() => {
    let active = true;
    const sequence = ++loadSequenceRef.current;
    void requestTasks().then(result => {
      if (active) applyTaskLoad(sequence, result);
    });
    return () => {
      active = false;
    };
  }, [applyTaskLoad]);

  function resetCreateIntent() {
    createKeyRef.current = null;
    setCreateError(null);
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle || creatingRef.current || loadState !== 'ready') return;

    let serializedDueAt: string | null = null;
    if (dueAt) {
      const selectedDueAt = new Date(dueAt);
      if (Number.isNaN(selectedDueAt.getTime()) || selectedDueAt.getTime() <= Date.now()) {
        setCreateError('Choose a future due time or leave it blank for the 24-hour default.');
        return;
      }
      serializedDueAt = selectedDueAt.toISOString();
    }

    creatingRef.current = true;
    setCreating(true);
    setCreateError(null);
    const key = createKeyRef.current ?? crypto.randomUUID();
    createKeyRef.current = key;

    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-idempotency-key': key,
        },
        body: JSON.stringify({
          title: normalizedTitle,
          detail: detail.trim() || null,
          dueAt: serializedDueAt,
        }),
      });

      if (!response.ok) {
        const error = await responseError(response, 'The task could not be created.');
        createKeyRef.current = null;
        setCreateError(error.message);
        return;
      }

      createKeyRef.current = null;
      setTitle('');
      setDetail('');
      setDueAt('');
      setAnnouncement(`Created task: ${normalizedTitle}.`);
      await loadTasks();
    } catch {
      setCreateError(
        'We could not confirm whether the task was created. Try again to safely replay the same request.',
      );
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }

  function openReasonEditor(taskId: string, action: 'blocked' | 'dismissed') {
    if (pendingTaskIdsRef.current.has(taskId)) return;
    setActionError(null);
    setActionEditor({ taskId, action, reason: '' });
  }

  async function updateTask(task: OfficeTask, action: TaskAction, rawReason?: string) {
    if (pendingTaskIdsRef.current.has(task.id) || loadState !== 'ready') return;
    const reason = rawReason?.trim() || null;
    if ((action === 'blocked' || action === 'dismissed') && !reason) {
      setActionError({ taskId: task.id, message: 'Enter a reason before saving this action.' });
      return;
    }

    const signature = JSON.stringify([task.id, action, reason]);
    const key = actionKeysRef.current.get(signature) ?? crypto.randomUUID();
    actionKeysRef.current.set(signature, key);
    pendingTaskIdsRef.current.add(task.id);
    setPendingTaskIds(new Set(pendingTaskIdsRef.current));
    setActionError(null);

    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-idempotency-key': key,
        },
        body: JSON.stringify({ status: action, reason }),
      });

      if (!response.ok) {
        const error = await responseError(response, 'The task action could not be saved.');
        actionKeysRef.current.delete(signature);
        setActionError({ taskId: task.id, message: error.message });
        return;
      }

      actionKeysRef.current.delete(signature);
      setTasks(current => {
        if (!current) return current;
        if (action === 'blocked') {
          return current.map(candidate => candidate.id === task.id
            ? { ...candidate, status: 'blocked', blockedReason: reason }
            : candidate);
        }
        return current.filter(candidate => candidate.id !== task.id);
      });
      setActionEditor(current => current?.taskId === task.id ? null : current);
      setAnnouncement(
        action === 'blocked'
          ? `Blocked task: ${task.title}.`
          : action === 'completed'
            ? `Completed task: ${task.title}.`
            : `Dismissed task: ${task.title}.`,
      );
    } catch {
      setActionError({
        taskId: task.id,
        message: 'We could not confirm the task action. Try again to safely replay the same request.',
      });
    } finally {
      pendingTaskIdsRef.current.delete(task.id);
      setPendingTaskIds(new Set(pendingTaskIdsRef.current));
    }
  }

  function submitReason(event: FormEvent<HTMLFormElement>, task: OfficeTask) {
    event.preventDefault();
    if (!actionEditor || actionEditor.taskId !== task.id) return;
    void updateTask(task, actionEditor.action, actionEditor.reason);
  }

  const canMutate = loadState === 'ready';

  return (
    <section
      className="mt-4 rounded-lg border border-[var(--op-border)] bg-white p-4 shadow-[var(--shadow-1)]"
      aria-labelledby="office-tasks-heading"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-[var(--op-dim)]">
            Manual Hub tasks
          </p>
          <h2 id="office-tasks-heading" className="mt-1 text-base font-semibold text-[var(--op-text)]">
            My open work
          </h2>
          <p className="mt-1 text-sm leading-5 text-[var(--op-text-2)]">
            New tasks are due 24 hours after creation unless you choose another future time.
          </p>
        </div>
        {tasks !== null && loadState === 'ready' ? (
          <span className="w-fit shrink-0 rounded-full bg-[var(--brand-cream)] px-2.5 py-1 text-xs font-medium text-[var(--brand-evergreen-3)]">
            {tasks.length} active
          </span>
        ) : null}
      </div>

      <form className="mt-4 grid gap-3" onSubmit={createTask} aria-busy={creating}>
        <div>
          <label htmlFor="office-task-title" className="text-sm font-semibold text-[var(--op-text)]">
            Task title
          </label>
          <input
            id="office-task-title"
            value={title}
            onChange={event => {
              setTitle(event.target.value);
              resetCreateIntent();
            }}
            maxLength={200}
            required
            disabled={!canMutate || creating}
            autoComplete="off"
            className="mt-1 min-h-11 w-full rounded-md border border-[var(--op-border-mid)] px-3 py-2 text-base text-[var(--op-text)] disabled:bg-[var(--op-bg)] disabled:opacity-70 sm:text-sm"
          />
        </div>
        <div>
          <label htmlFor="office-task-detail" className="text-sm font-semibold text-[var(--op-text)]">
            Details <span className="font-normal text-[var(--op-dim)]">(optional)</span>
          </label>
          <textarea
            id="office-task-detail"
            value={detail}
            onChange={event => {
              setDetail(event.target.value);
              resetCreateIntent();
            }}
            maxLength={2000}
            rows={2}
            disabled={!canMutate || creating}
            className="mt-1 w-full rounded-md border border-[var(--op-border-mid)] px-3 py-2 text-base text-[var(--op-text)] disabled:bg-[var(--op-bg)] disabled:opacity-70 sm:text-sm"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <label htmlFor="office-task-due-at" className="text-sm font-semibold text-[var(--op-text)]">
              Due time <span className="font-normal text-[var(--op-dim)]">(optional)</span>
            </label>
            <input
              id="office-task-due-at"
              type="datetime-local"
              value={dueAt}
              onChange={event => {
                setDueAt(event.target.value);
                resetCreateIntent();
              }}
              disabled={!canMutate || creating}
              aria-describedby="office-task-due-help"
              className="mt-1 min-h-11 w-full rounded-md border border-[var(--op-border-mid)] px-3 py-2 text-base text-[var(--op-text)] disabled:bg-[var(--op-bg)] disabled:opacity-70 sm:text-sm"
            />
            <p id="office-task-due-help" className="mt-1 text-xs text-[var(--op-dim)]">
              Leave blank to use the 24-hour default.
            </p>
          </div>
          <button
            type="submit"
            disabled={!canMutate || creating || !title.trim()}
            className="min-h-11 rounded-md bg-[var(--brand-evergreen)] px-4 py-2 text-sm font-semibold text-[var(--brand-cream)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? 'Adding…' : 'Add task'}
          </button>
        </div>
        {createError ? (
          <p className="text-sm text-[#9F2D20]" role="alert">{createError}</p>
        ) : null}
      </form>

      {loadState !== 'ready' ? (
        <div
          className="mt-4 rounded-md border border-[var(--op-border)] bg-[var(--op-bg)] p-3 text-sm text-[var(--op-text-2)]"
          role={loadState === 'error' ? 'alert' : 'status'}
        >
          <p>{loadMessage}</p>
          {loadState === 'error' || loadState === 'unavailable' ? (
            <button
              type="button"
              onClick={() => void loadTasks()}
              className="mt-2 min-h-11 rounded-md border border-[var(--op-border-mid)] bg-white px-3 py-2 font-semibold text-[var(--op-text)]"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : tasks?.length === 0 ? (
        <p className="mt-4 rounded-md bg-[var(--op-bg)] p-3 text-sm text-[var(--op-text-2)]">
          No open or blocked tasks. Manual tasks will appear here.
        </p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {tasks?.map(task => {
            const pending = pendingTaskIds.has(task.id);
            const editing = actionEditor?.taskId === task.id ? actionEditor : null;
            return (
              <li
                key={task.id}
                className="rounded-lg border border-[var(--op-border)] p-3"
                aria-busy={pending}
              >
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="break-words text-sm font-semibold text-[var(--op-text)]">{task.title}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        task.status === 'blocked'
                          ? 'bg-[#FBE6DF] text-[#7A2E20]'
                          : 'bg-[var(--brand-cream)] text-[var(--brand-evergreen-3)]'
                      }`}>
                        {task.status === 'blocked' ? 'Blocked' : 'Open'}
                      </span>
                    </div>
                    {task.detail ? (
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-[var(--op-text-2)]">
                        {task.detail}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-[var(--op-dim)]">Due {formatDueTime(task.dueAt)}</p>
                    {task.status === 'blocked' && task.blockedReason ? (
                      <p className="mt-2 rounded-md bg-[#FFF4EF] px-2.5 py-2 text-sm text-[#6D2A20]">
                        <span className="font-semibold">Blocked because:</span> {task.blockedReason}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void updateTask(task, 'completed')}
                      disabled={pending || !canMutate}
                      className="min-h-11 rounded-md bg-[var(--brand-evergreen)] px-3 py-2 text-sm font-semibold text-[var(--brand-cream)] disabled:opacity-50"
                    >
                      {pending ? 'Saving…' : 'Complete'}
                    </button>
                    {task.status === 'open' ? (
                      <button
                        type="button"
                        onClick={() => openReasonEditor(task.id, 'blocked')}
                        disabled={pending || !canMutate}
                        className="min-h-11 rounded-md border border-[var(--op-border-mid)] bg-white px-3 py-2 text-sm font-semibold text-[var(--op-text)] disabled:opacity-50"
                      >
                        Block
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => openReasonEditor(task.id, 'dismissed')}
                      disabled={pending || !canMutate}
                      className="min-h-11 rounded-md border border-[var(--op-border-mid)] bg-white px-3 py-2 text-sm font-semibold text-[var(--op-text)] disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>

                {editing ? (
                  <form className="mt-3 rounded-md bg-[var(--op-bg)] p-3" onSubmit={event => submitReason(event, task)}>
                    <label
                      htmlFor={`office-task-reason-${task.id}`}
                      className="text-sm font-semibold text-[var(--op-text)]"
                    >
                      {editing.action === 'blocked' ? 'Reason for blocking' : 'Reason for dismissing'}
                    </label>
                    <textarea
                      id={`office-task-reason-${task.id}`}
                      value={editing.reason}
                      onChange={event => {
                        setActionEditor({ ...editing, reason: event.target.value });
                        setActionError(null);
                      }}
                      maxLength={500}
                      rows={2}
                      required
                      disabled={pending}
                      className="mt-1 w-full rounded-md border border-[var(--op-border-mid)] bg-white px-3 py-2 text-base text-[var(--op-text)] disabled:opacity-70 sm:text-sm"
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="submit"
                        disabled={pending || !editing.reason.trim()}
                        className="min-h-11 rounded-md bg-[var(--brand-evergreen)] px-3 py-2 text-sm font-semibold text-[var(--brand-cream)] disabled:opacity-50"
                      >
                        {pending ? 'Saving…' : editing.action === 'blocked' ? 'Confirm block' : 'Confirm dismiss'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActionEditor(null);
                          setActionError(null);
                        }}
                        disabled={pending}
                        className="min-h-11 rounded-md border border-[var(--op-border-mid)] bg-white px-3 py-2 text-sm font-semibold text-[var(--op-text)] disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : null}

                {actionError?.taskId === task.id ? (
                  <p className="mt-2 text-sm text-[#9F2D20]" role="alert">
                    {actionError.message}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
    </section>
  );
}
