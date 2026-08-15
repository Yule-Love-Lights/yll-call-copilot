// Coverage for the reviewer-flagged MED: reveal_photo sends to N crew
// contacts in a loop, and a failure partway through used to revert the
// WHOLE touch to 'pending' even though earlier recipients already got the
// SMS -- a retry then re-sent to them. The fix records each successful send
// in payload.sent_to and skips those contacts on a retry. Mocks Supabase the
// same way src/lib/leads/queue.test.ts mocks it (a fake `from()` builder),
// plus the GHL/session/crew-resolution seams this route imports.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// vi.mock factories are hoisted above the rest of the file, so the class
// they reference has to be created through vi.hoisted (a plain top-level
// `class FakeHighLevelError` declared here would throw a
// temporal-dead-zone ReferenceError once hoisted above itself).
const { FakeHighLevelError } = vi.hoisted(() => {
  class FakeHighLevelError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.name = 'HighLevelError';
      this.status = status;
    }
  }
  return { FakeHighLevelError };
});

const sendConversationMessageMock = vi.fn();
vi.mock('@/lib/ghl/client', () => ({
  HighLevelError: FakeHighLevelError,
  isHighLevelConfigured: () => true,
  sendConversationMessage: (...args: unknown[]) => sendConversationMessageMock(...args),
}));

const resolveCrewContactIdsMock = vi.fn();
vi.mock('@/lib/ghl/secondMile', () => ({
  resolveCrewContactIds: (...args: unknown[]) => resolveCrewContactIdsMock(...args),
}));

vi.mock('@/lib/auth/session', () => ({
  getSessionEmail: () => Promise.resolve('rep@yulelovelights.com'),
}));

let fakeClient: SupabaseClient;
vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: () => true,
  isMissingTableError: () => false,
  getSupabaseServerClient: () => fakeClient,
}));

import { POST } from './route';

type Row = {
  id: string;
  ghl_contact_id: string | null;
  customer_name: string | null;
  kind: string;
  status: string;
  payload: Record<string, unknown> | null;
};

// A fake `second_mile_touches` table: select().eq().maybeSingle() reads the
// live row; update(patch).eq('id',...).eq('status','pending').select('id')
// is a real compare-and-swap (only applies + returns a row when the live
// status still matches the filter, same atomicity a real UPDATE...WHERE
// gives in Postgres); update(patch).eq('id',...) with no status filter
// (the sent_to persist / revert calls) always applies.
function fakeSupabase(initialRow: Row) {
  const row: Row = { ...initialRow };
  const updates: Record<string, unknown>[] = [];

  function makeUpdateBuilder(patch: Record<string, unknown>) {
    const filters: Record<string, unknown> = {};
    function resolve() {
      if ('id' in filters && filters.id !== row.id) {
        return Promise.resolve({ data: [], error: null });
      }
      if ('status' in filters && filters.status !== row.status) {
        return Promise.resolve({ data: [], error: null });
      }
      Object.assign(row, patch);
      updates.push({ ...patch });
      return Promise.resolve({ data: [{ id: row.id }], error: null });
    }
    const builder = {
      eq(field: string, value: unknown) {
        filters[field] = value;
        return builder;
      },
      select() {
        return resolve();
      },
      then(onFulfilled: (v: { data: unknown; error: null }) => unknown, onRejected?: (e: unknown) => unknown) {
        return resolve().then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  const from = vi.fn((table: string) => {
    if (table !== 'second_mile_touches') throw new Error(`Unexpected table in test: ${table}`);
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { ...row }, error: null }),
        }),
      }),
      update: (patch: Record<string, unknown>) => makeUpdateBuilder(patch),
    };
  });

  return { client: { from } as unknown as SupabaseClient, getRow: () => ({ ...row }), updates };
}

function postTo(id: string) {
  return POST(new Request('http://localhost/api/second-mile/x/send', { method: 'POST' }), { params: Promise.resolve({ id }) });
}

const REVEAL_ROW: Row = {
  id: 'touch-1',
  ghl_contact_id: null,
  customer_name: 'Jordan',
  kind: 'reveal_photo',
  status: 'pending',
  payload: { draftBody: 'Reveal shot time.', address: '123 Main St' },
};

describe('POST /api/second-mile/[id]/send', () => {
  const prevSendEnabled = process.env.GHL_SEND_ENABLED;

  beforeEach(() => {
    process.env.GHL_SEND_ENABLED = 'true';
    sendConversationMessageMock.mockReset();
    resolveCrewContactIdsMock.mockReset();
  });

  afterEach(() => {
    process.env.GHL_SEND_ENABLED = prevSendEnabled;
  });

  it('retry after a partial failure skips already-sent recipients', async () => {
    resolveCrewContactIdsMock.mockResolvedValue(['c1', 'c2', 'c3']);
    // First attempt: c1 sends fine, c2 fails, c3 never gets tried in the OLD
    // code (loop aborts) but the fix keeps going so we know its outcome too.
    sendConversationMessageMock.mockImplementation(({ contactId }: { contactId: string }) => {
      if (contactId === 'c2') return Promise.reject(new FakeHighLevelError('GHL 500', 500));
      return Promise.resolve({ messageId: `m-${contactId}` });
    });

    const { client, getRow } = fakeSupabase(REVEAL_ROW);
    fakeClient = client;

    const res1 = await postTo('touch-1');
    const json1 = await res1.json();

    expect(json1.sent).toBe(false);
    expect(json1.failedContactIds).toEqual(['c2']);
    expect(json1.sentCount).toBe(2); // c1 and c3
    expect(getRow().status).toBe('pending'); // reverted, retry is possible
    expect(getRow().payload?.sent_to).toEqual(expect.arrayContaining(['c1', 'c3']));
    expect((getRow().payload?.sent_to as string[]).length).toBe(2);
    expect(sendConversationMessageMock).toHaveBeenCalledTimes(3);

    // Retry: c2 is the only one still missing the message.
    sendConversationMessageMock.mockClear();
    sendConversationMessageMock.mockResolvedValue({ messageId: 'm-c2-retry' });

    const res2 = await postTo('touch-1');
    const json2 = await res2.json();

    expect(json2.sent).toBe(true);
    expect(sendConversationMessageMock).toHaveBeenCalledTimes(1);
    expect(sendConversationMessageMock).toHaveBeenCalledWith(expect.objectContaining({ contactId: 'c2' }));
    expect(getRow().status).toBe('done');
    expect((getRow().payload?.sent_to as string[]).sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('retry after a total failure sends to everyone (nobody was skipped)', async () => {
    resolveCrewContactIdsMock.mockResolvedValue(['c1', 'c2']);
    sendConversationMessageMock.mockRejectedValue(new FakeHighLevelError('GHL down', 503));

    const { client, getRow } = fakeSupabase(REVEAL_ROW);
    fakeClient = client;

    const res1 = await postTo('touch-1');
    const json1 = await res1.json();
    expect(json1.sent).toBe(false);
    expect(json1.sentCount).toBe(0);
    expect(getRow().status).toBe('pending');
    expect(getRow().payload?.sent_to).toEqual([]);

    sendConversationMessageMock.mockReset();
    sendConversationMessageMock.mockResolvedValue({ messageId: 'ok' });

    const res2 = await postTo('touch-1');
    const json2 = await res2.json();

    expect(json2.sent).toBe(true);
    expect(sendConversationMessageMock).toHaveBeenCalledTimes(2);
    expect(getRow().status).toBe('done');
    expect((getRow().payload?.sent_to as string[]).sort()).toEqual(['c1', 'c2']);
  });

  it('keeps the legacy customer check-in sender disabled until safe reconciliation exists', async () => {
    const coldSnapRow: Row = {
      id: 'touch-2',
      ghl_contact_id: 'cust-1',
      customer_name: 'Sam',
      kind: 'cold_snap_checkin',
      status: 'pending',
      payload: {},
    };
    const { client, getRow } = fakeSupabase(coldSnapRow);
    fakeClient = client;
    sendConversationMessageMock.mockResolvedValue({ messageId: 'm1' });

    const response = await postTo('touch-2');
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json).toMatchObject({ sent: false, reason: expect.stringContaining('not available yet') });
    expect(sendConversationMessageMock).not.toHaveBeenCalled();
    expect(getRow().status).toBe('pending');
  });
});
