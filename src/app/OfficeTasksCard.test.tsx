/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OfficeTasksCard from './OfficeTasksCard';

const OPEN_TASK_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_TASK_ID = '22222222-2222-4222-8222-222222222222';
const IDEMPOTENCY_KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NEXT_IDEMPOTENCY_KEY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type Task = {
  id: string;
  title: string;
  detail: string | null;
  status: 'open' | 'blocked';
  dueAt: string;
  createdAt: string;
  blockedReason: string | null;
};

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: OPEN_TASK_ID,
    title: 'Confirm office supply order',
    detail: null,
    status: 'open',
    dueAt: '2026-08-22T14:00:00.000Z',
    createdAt: '2026-08-21T14:00:00.000Z',
    blockedReason: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => {
    resolve = next;
  });
  return { promise, resolve };
}

function changeControl(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = control instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(control, value);
  control.dispatchEvent(new Event('input', { bubbles: true }));
}

function button(container: HTMLElement, name: string | RegExp): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(candidate => {
    const text = candidate.textContent?.trim() ?? '';
    return typeof name === 'string' ? text === name : name.test(text);
  });
  if (!match) throw new Error(`missing button ${String(name)}`);
  return match;
}

function controlByLabel(
  container: HTMLElement,
  name: string | RegExp,
): HTMLInputElement | HTMLTextAreaElement {
  const label = [...container.querySelectorAll('label')].find(candidate => {
    const text = candidate.textContent?.trim() ?? '';
    return typeof name === 'string' ? text === name : name.test(text);
  });
  if (!label) throw new Error(`missing label ${String(name)}`);

  const control = label.htmlFor
    ? container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${label.htmlFor}`)
    : label.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
  if (!control) throw new Error(`label ${String(name)} has no form control`);
  return control;
}

function itemFor(container: HTMLElement, title: string): HTMLLIElement | undefined {
  return [...container.querySelectorAll('li')].find(item => item.textContent?.includes(title));
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('OfficeTasksCard', () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    document.body.replaceChildren();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => IDEMPOTENCY_KEY) });
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it('creates a labeled manual task once while a duplicate click is pending', async () => {
    const creation = deferred<Response>();
    const createdTask = task({ title: 'Confirm permit pickup' });
    let getCount = 0;
    fetchMock.mockImplementation((_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return creation.promise;
      getCount += 1;
      return Promise.resolve(jsonResponse({ tasks: getCount === 1 ? [] : [createdTask] }));
    });

    act(() => root.render(<OfficeTasksCard />));
    await settle();

    const title = controlByLabel(container, /task title/i);
    act(() => changeControl(title, 'Confirm permit pickup'));
    const add = button(container, /^add task$/i);
    act(() => {
      add.click();
      add.click();
    });
    await settle();

    const postCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(postCalls).toHaveLength(1);
    expect(add.disabled).toBe(true);
    const [, requestInit] = postCalls[0] as [string, RequestInit];
    expect(new Headers(requestInit.headers).get('x-idempotency-key')).toBe(IDEMPOTENCY_KEY);
    expect(JSON.parse(String(requestInit.body))).toEqual({
      title: 'Confirm permit pickup',
      detail: null,
      dueAt: null,
    });

    act(() => creation.resolve(jsonResponse({ taskId: OPEN_TASK_ID })));
    await settle();
    expect(itemFor(container, 'Confirm permit pickup')).toBeDefined();
  });

  it('reuses the create idempotency key after an ambiguous server failure', async () => {
    const createdTask = task({ title: 'Confirm permit pickup' });
    const randomUUID = vi.fn()
      .mockReturnValueOnce(IDEMPOTENCY_KEY)
      .mockReturnValueOnce(NEXT_IDEMPOTENCY_KEY);
    vi.stubGlobal('crypto', { randomUUID });
    let postCount = 0;
    let getCount = 0;
    fetchMock.mockImplementation((_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        postCount += 1;
        return Promise.resolve(postCount === 1
          ? jsonResponse({
              error: { code: 'TASK_CREATE_FAILED', message: 'The task could not be saved.' },
            }, 500)
          : jsonResponse({ taskId: OPEN_TASK_ID }, 201));
      }
      getCount += 1;
      return Promise.resolve(jsonResponse({ tasks: getCount === 1 ? [] : [createdTask] }));
    });

    act(() => root.render(<OfficeTasksCard />));
    await settle();
    act(() => changeControl(controlByLabel(container, /task title/i), createdTask.title));

    act(() => button(container, /^add task$/i).click());
    await settle();
    act(() => button(container, /^add task$/i).click());
    await settle();

    const postCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(postCalls).toHaveLength(2);
    expect(postCalls.map(([, init]) => new Headers(init?.headers).get('x-idempotency-key')))
      .toEqual([IDEMPOTENCY_KEY, IDEMPOTENCY_KEY]);
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(itemFor(container, createdTask.title)).toBeDefined();
  });

  it('requires an inline block reason and keeps the blocked task visible', async () => {
    const row = task();
    fetchMock.mockImplementation((_input: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ taskId: row.id }));
      }
      return Promise.resolve(jsonResponse({ tasks: [row] }));
    });
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null);

    act(() => root.render(<OfficeTasksCard />));
    await settle();
    act(() => button(container, /^block$/i).click());

    expect(prompt).not.toHaveBeenCalled();
    const reason = controlByLabel(container, /reason.*block|block.*reason/i);
    expect(reason.required).toBe(true);
    act(() => button(container, /block task|confirm block/i).click());
    await settle();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);

    act(() => changeControl(reason, 'Waiting for vendor confirmation'));
    act(() => button(container, /block task|confirm block/i).click());
    await settle();

    const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(patchCalls).toHaveLength(1);
    expect(JSON.parse(String((patchCalls[0]?.[1] as RequestInit).body))).toEqual({
      status: 'blocked',
      reason: 'Waiting for vendor confirmation',
    });
    expect(itemFor(container, row.title)?.textContent).toMatch(/blocked/i);
  });

  it('protects completion from duplicate clicks and removes the completed task', async () => {
    const row = task();
    const completion = deferred<Response>();
    fetchMock.mockImplementation((_input: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return completion.promise;
      return Promise.resolve(jsonResponse({ tasks: [row] }));
    });

    act(() => root.render(<OfficeTasksCard />));
    await settle();
    const complete = button(container, /complete|done/i);
    act(() => {
      complete.click();
      complete.click();
    });
    await settle();

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
    expect(complete.disabled).toBe(true);
    act(() => completion.resolve(jsonResponse({ taskId: row.id })));
    await settle();
    expect(itemFor(container, row.title)).toBeUndefined();
  });

  it('reuses the action idempotency key after an ambiguous server failure', async () => {
    const row = task();
    const randomUUID = vi.fn()
      .mockReturnValueOnce(IDEMPOTENCY_KEY)
      .mockReturnValueOnce(NEXT_IDEMPOTENCY_KEY);
    vi.stubGlobal('crypto', { randomUUID });
    let patchCount = 0;
    fetchMock.mockImplementation((_input: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        patchCount += 1;
        return Promise.resolve(patchCount === 1
          ? jsonResponse({
              error: { code: 'TASK_UPDATE_FAILED', message: 'The task action could not be saved.' },
            }, 500)
          : jsonResponse({ taskId: row.id }));
      }
      return Promise.resolve(jsonResponse({ tasks: [row] }));
    });

    act(() => root.render(<OfficeTasksCard />));
    await settle();

    act(() => button(container, /complete|done/i).click());
    await settle();
    act(() => button(container, /complete|done/i).click());
    await settle();

    const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(patchCalls).toHaveLength(2);
    expect(patchCalls.map(([, init]) => new Headers(init?.headers).get('x-idempotency-key')))
      .toEqual([IDEMPOTENCY_KEY, IDEMPOTENCY_KEY]);
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(itemFor(container, row.title)).toBeUndefined();
  });

  it('gives each task action a task-specific accessible name', async () => {
    const first = task();
    const second = task({ id: SECOND_TASK_ID, title: 'Review returned equipment' });
    fetchMock.mockResolvedValue(jsonResponse({ tasks: [first, second] }));

    act(() => root.render(<OfficeTasksCard />));
    await settle();

    expect(container.querySelector(
      `button[aria-label="Complete task: ${first.title}"]`,
    )).not.toBeNull();
    expect(container.querySelector(
      `button[aria-label="Complete task: ${second.title}"]`,
    )).not.toBeNull();
    expect(container.querySelector(
      `button[aria-label="Block task: ${first.title}"]`,
    )).not.toBeNull();
    expect(container.querySelector(
      `button[aria-label="Dismiss task: ${second.title}"]`,
    )).not.toBeNull();
  });

  it('requires an inline dismiss reason and removes a dismissed task', async () => {
    const row = task();
    fetchMock.mockImplementation((_input: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return Promise.resolve(jsonResponse({ taskId: row.id }));
      return Promise.resolve(jsonResponse({ tasks: [row] }));
    });

    act(() => root.render(<OfficeTasksCard />));
    await settle();
    act(() => button(container, /^dismiss$/i).click());
    const reason = controlByLabel(container, /reason.*dismiss|dismiss.*reason/i);
    expect(reason.required).toBe(true);
    act(() => button(container, /dismiss task|confirm dismiss/i).click());
    await settle();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);

    act(() => changeControl(reason, 'No longer needed'));
    act(() => button(container, /dismiss task|confirm dismiss/i).click());
    await settle();
    expect(itemFor(container, row.title)).toBeUndefined();
  });

  it('shows a truthful load error and can retry without reloading the page', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        error: {
          code: 'TASKS_NOT_READY',
          message: 'Manual Hub tasks are temporarily unavailable.',
        },
      }, 503))
      .mockResolvedValueOnce(jsonResponse({ tasks: [] }));

    act(() => root.render(<OfficeTasksCard />));
    await settle();

    const alert = container.querySelector<HTMLElement>('[role="alert"], [role="status"]');
    expect(alert?.textContent).toMatch(/temporarily unavailable|could not load/i);
    act(() => button(container, /try again|retry/i).click());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toMatch(/no open or blocked tasks/i);
  });

  it('keeps known tasks visible when an action fails', async () => {
    const row = task({
      id: SECOND_TASK_ID,
      title: 'Review returned equipment',
    });
    fetchMock.mockImplementation((_input: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({
          error: {
            code: 'TASK_STATE_CONFLICT',
            message: 'This task changed before the action could be saved.',
          },
        }, 409));
      }
      return Promise.resolve(jsonResponse({ tasks: [row] }));
    });

    act(() => root.render(<OfficeTasksCard />));
    await settle();
    act(() => button(container, /complete|done/i).click());
    await settle();

    expect(itemFor(container, row.title)).toBeDefined();
    expect(container.querySelector<HTMLElement>('[role="alert"]')?.textContent).toMatch(
      /could not|unable|changed/i,
    );
    expect(container.textContent).not.toMatch(/task setup is not available/i);
  });
});
