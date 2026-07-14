// Coverage for ingestInboundEmail: idempotency on source_message_id (the
// live webhook and the /api/inbox/check fallback poll can both see the same
// GHL message), the missing-migration degrade, and the "drafting is
// best-effort, never fails the ingest" contract that lets a Claude failure
// leave the row for the retry sweep. generateEmailReply itself is mocked --
// its own behavior is covered by draft.test.ts; this file only tests the
// orchestration this module adds. Same fakeSupabase-per-table style as
// src/lib/playbook/versions.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const generateEmailReplyMock = vi.fn();

vi.mock('./draft', async () => {
  const actual = await vi.importActual<typeof import('./draft')>('./draft');
  return {
    ...actual,
    generateEmailReply: (...args: unknown[]) => generateEmailReplyMock(...args),
  };
});

import { ingestInboundEmail, draftForInboundEmail, appliesToVertical, loadGuarantees } from './ingest';
import { mapGhlInboundEmailPayload } from './webhook';

const sampleDraft = { intent: 'question', subject: 'Re: hi', body: 'Yes we do!', guarantee_used: 'all_inclusive' };

type FakeOpts = {
  existingInboundEmail?: { id: string } | null;
  existingCheckError?: { code?: string; message: string } | null;
  insertError?: { code?: string; message: string } | null;
  // Controls the result of every `inbound_emails` .update(...) chain --
  // real code only ever inspects the claim update's result (data/error), so
  // one shared knob is enough to simulate a losing claim race (empty data)
  // or a hard error, while every other update in the flow (the revert-to-
  // 'new', the final intent+status write) just needs `error: null`.
  updateResult?: { data?: unknown; error?: unknown };
};

// A single chained object that answers both call shapes real code uses on
// `.update(...)`: a plain `.eq(...)` awaited directly for `{error}` (the
// revert-to-'new' and final status writes), and the claim's
// `.eq(...).eq(...).select(...)` awaited for `{data, error}`. `.eq()` always
// returns the same chain so any number of them can be composed, and the
// chain itself is thenable so awaiting it without a trailing `.select()`
// still resolves.
function updateChain(result: { data?: unknown; error?: unknown }) {
  const chain = {
    eq: () => chain,
    select: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function fakeSupabase(opts: FakeOpts = {}) {
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];

  const from = vi.fn((table: string) => {
    if (table === 'inbound_emails') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: opts.existingInboundEmail ?? null, error: opts.existingCheckError ?? null }),
          }),
        }),
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: () => {
              if (opts.insertError) return Promise.resolve({ data: null, error: opts.insertError });
              inserted.push(row);
              return Promise.resolve({ data: { id: 'inbound1' }, error: null });
            },
          }),
        }),
        update: (row: Record<string, unknown>) => {
          updated.push(row);
          return updateChain(opts.updateResult ?? { data: [{ id: 'inbound1' }], error: null });
        },
      };
    }
    if (table === 'verticals') {
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
    }
    if (table === 'offer_versions') {
      return {
        select: () => ({
          order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { code: 'PGRST205', message: 'missing' } }) }) }),
        }),
      };
    }
    if (table === 'email_reply_drafts') {
      return { insert: (row: Record<string, unknown>) => { inserted.push(row); return Promise.resolve({ error: null }); } };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return { client: { from } as unknown as SupabaseClient, inserted, updated };
}

describe('ingestInboundEmail', () => {
  beforeEach(() => {
    generateEmailReplyMock.mockReset();
  });

  it('skips a duplicate source_message_id without inserting', async () => {
    const { client, inserted } = fakeSupabase({ existingInboundEmail: { id: 'existing1' } });

    const result = await ingestInboundEmail(client, {
      source: 'ghl',
      sourceMessageId: 'msg1',
      fromAddress: 'a@example.com',
      fromName: 'Alex',
      subject: 'hi',
      body: 'hello',
      receivedAt: null,
    });

    expect(result).toEqual({ ok: true, inserted: false, reason: expect.stringMatching(/duplicate/i) });
    expect(inserted).toEqual([]);
    expect(generateEmailReplyMock).not.toHaveBeenCalled();
  });

  it('degrades to a friendly reason when the migration has not been applied', async () => {
    const { client } = fakeSupabase({ existingCheckError: { code: 'PGRST205', message: 'missing table' } });

    const result = await ingestInboundEmail(client, {
      source: 'ghl',
      sourceMessageId: 'msg2',
      fromAddress: null,
      fromName: null,
      subject: null,
      body: 'hello',
      receivedAt: null,
    });

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/migration 0012/i), missingTable: true });
  });

  it('inserts and drafts on the happy path', async () => {
    generateEmailReplyMock.mockResolvedValue(sampleDraft);
    const { client, inserted, updated } = fakeSupabase();

    const result = await ingestInboundEmail(client, {
      source: 'ghl',
      sourceMessageId: 'msg3',
      ghlContactId: 'c1',
      ghlConversationId: 'convo1',
      fromAddress: 'a@example.com',
      fromName: 'Alex',
      subject: 'question',
      body: 'Do you service my area?',
      receivedAt: '2026-07-14T00:00:00Z',
    });

    expect(result).toEqual({ ok: true, inserted: true, inboundEmailId: 'inbound1', drafted: true });
    expect(inserted.some(row => row.body === 'Do you service my area?')).toBe(true);
    expect(inserted.some(row => row.subject === sampleDraft.subject)).toBe(true);
    // First update is the claim (status 'new' -> 'drafted') before the slow
    // Claude call; second is the final intent + status write on success.
    expect(updated).toEqual([{ status: 'drafted' }, { intent: sampleDraft.intent, status: 'drafted' }]);
  });

  it('leaves the row undrafted (best-effort) when Claude generation fails, without failing the ingest', async () => {
    generateEmailReplyMock.mockRejectedValue(new Error('Claude not configured.'));
    const { client, updated } = fakeSupabase();

    const result = await ingestInboundEmail(client, {
      source: 'ghl',
      sourceMessageId: 'msg4',
      fromAddress: null,
      fromName: null,
      subject: null,
      body: 'hello',
      receivedAt: null,
    });

    expect(result).toEqual({ ok: true, inserted: true, inboundEmailId: 'inbound1', drafted: false });
    // Claimed ('new' -> 'drafted'), then Claude failed, then reverted back
    // to 'new' so the retry sweep / a manual redraft can pick it up.
    expect(updated).toEqual([{ status: 'drafted' }, { status: 'new' }]);
  });

  it('treats a unique-violation on insert as a harmless duplicate (concurrent ingest race)', async () => {
    const { client, inserted } = fakeSupabase({ insertError: { code: '23505', message: 'duplicate key' } });

    const result = await ingestInboundEmail(client, {
      source: 'ghl',
      sourceMessageId: 'msg5',
      fromAddress: null,
      fromName: null,
      subject: null,
      body: 'hello',
      receivedAt: null,
    });

    expect(result).toEqual({ ok: true, inserted: false, reason: expect.stringMatching(/duplicate/i) });
    expect(inserted).toEqual([]);
  });
});

// draftForInboundEmail's own claim (status 'new' -> 'drafted' before the
// slow Claude call) -- the /api/inbox/check retry sweep racing the webhook's
// own draft, or two overlapping check-now clicks, must not both draft (and
// bill) the same email twice.
describe('draftForInboundEmail claim/revert', () => {
  beforeEach(() => {
    generateEmailReplyMock.mockReset();
  });

  const inboundEmail = { id: 'inbound1', subject: 'question', body: 'Do you service my area?', from_name: 'Alex' };

  it('is a no-op when a concurrent caller already claimed the row (update matches zero rows)', async () => {
    const { client, updated, inserted } = fakeSupabase({ updateResult: { data: [], error: null } });

    const result = await draftForInboundEmail(client, inboundEmail);

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/already claimed/i) });
    // Only the (losing) claim attempt happened -- no revert, no Claude call.
    expect(updated).toEqual([{ status: 'drafted' }]);
    expect(inserted).toEqual([]);
    expect(generateEmailReplyMock).not.toHaveBeenCalled();
  });

  it('reverts the row to \'new\' when Claude generation fails after a successful claim', async () => {
    generateEmailReplyMock.mockRejectedValue(new Error('Claude not configured.'));
    const { client, updated } = fakeSupabase();

    const result = await draftForInboundEmail(client, inboundEmail);

    expect(result).toEqual({ ok: false, error: 'Claude not configured.' });
    expect(updated).toEqual([{ status: 'drafted' }, { status: 'new' }]);
  });

  it('succeeds normally when the claim wins and Claude generation succeeds', async () => {
    generateEmailReplyMock.mockResolvedValue(sampleDraft);
    const { client, updated } = fakeSupabase();

    const result = await draftForInboundEmail(client, inboundEmail);

    expect(result).toEqual({ ok: true });
    expect(updated).toEqual([{ status: 'drafted' }, { intent: sampleDraft.intent, status: 'drafted' }]);
  });
});

// appliesToVertical: FIX for a MED contract bug -- applies_to: 'all' was
// treated as a literal slug (so it never matched any real vertical, silently
// dropping headline guarantees like all_inclusive/referral_ask from every
// draft once offer_versions is seeded), and a comma-list string like
// "holiday,permanent" was never split before matching.
describe('appliesToVertical', () => {
  it('treats "all" as a wildcard that matches every vertical', () => {
    expect(appliesToVertical('all', 'holiday')).toBe(true);
    expect(appliesToVertical('all', 'permanent')).toBe(true);
    expect(appliesToVertical(['all'], 'event')).toBe(true);
  });

  it('splits a comma-list string before matching', () => {
    expect(appliesToVertical('holiday,permanent', 'holiday')).toBe(true);
    expect(appliesToVertical('holiday,permanent', 'permanent')).toBe(true);
    expect(appliesToVertical('holiday,permanent', 'event')).toBe(false);
  });

  it('still matches a literal slug or array of slugs', () => {
    expect(appliesToVertical('holiday', 'holiday')).toBe(true);
    expect(appliesToVertical(['holiday', 'event'], 'event')).toBe(true);
    expect(appliesToVertical(['holiday', 'event'], 'permanent')).toBe(false);
  });

  it('treats null/empty as applying to every vertical (unchanged prior behavior)', () => {
    expect(appliesToVertical(null, 'holiday')).toBe(true);
    expect(appliesToVertical([], 'holiday')).toBe(true);
  });
});

// loadGuarantees: covers both the 'all'/comma-list applies_to fix and the
// active===false filter (a deactivated offer element must stop being quoted
// to customers) at the level that actually assembles the candidate set fed
// to generateEmailReply.
describe('loadGuarantees', () => {
  function fakeSupabaseWithOfferElements(elements: Record<string, unknown>[]) {
    const from = vi.fn((table: string) => {
      if (table === 'offer_versions') {
        return {
          select: () => ({
            order: () => ({
              limit: () => ({ maybeSingle: () => Promise.resolve({ data: { content: { elements } }, error: null }) }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    });
    return { from } as unknown as SupabaseClient;
  }

  it('includes an "all" element in the candidate set for a holiday email', async () => {
    const client = fakeSupabaseWithOfferElements([
      { key: 'all_inclusive', customer_line: 'Design, install, service, takedown, all in the number.', applies_to: 'all' },
    ]);

    const result = await loadGuarantees(client, 'holiday');

    expect(result).toEqual([{ key: 'all_inclusive', text: 'Design, install, service, takedown, all in the number.' }]);
  });

  it('includes an element whose applies_to is a comma-list covering the requested vertical', async () => {
    const client = fakeSupabaseWithOfferElements([
      { key: 'referral_ask', customer_line: 'Know someone who needs us? Send them our way.', applies_to: 'holiday,permanent' },
    ]);

    const result = await loadGuarantees(client, 'permanent');

    expect(result).toEqual([{ key: 'referral_ask', text: 'Know someone who needs us? Send them our way.' }]);
  });

  it('filters out an element with active === false', async () => {
    const client = fakeSupabaseWithOfferElements([
      { key: 'retired_promo', customer_line: 'A promo we no longer run.', applies_to: 'all', active: false },
      { key: 'all_inclusive', customer_line: 'Design, install, service, takedown, all in the number.', applies_to: 'all', active: true },
    ]);

    const result = await loadGuarantees(client, 'holiday');

    expect(result).toEqual([{ key: 'all_inclusive', text: 'Design, install, service, takedown, all in the number.' }]);
  });
});

// End-to-end FIX for a redelivered GHL webhook with no message id: before
// the fix, a null source_message_id defeated dedup entirely (Postgres
// treats every NULL as distinct, and ingestInboundEmail's existence check
// skips null ids), so a retry (e.g. GHL timing out on our synchronous Claude
// drafting call) inserted and drafted the same email a second time. Uses an
// in-memory stateful fake (real dedup semantics: source_message_id unique +
// an existence check) across two full mapGhlInboundEmailPayload ->
// ingestInboundEmail calls, the same two steps POST /api/webhooks/ghl runs.
describe('webhook redelivery with no GHL message id (derived source_message_id dedup)', () => {
  function statefulFakeSupabase() {
    const rows: Record<string, unknown>[] = [];
    const from = vi.fn((table: string) => {
      if (table === 'inbound_emails') {
        return {
          select: () => ({
            eq: (col: string, val: unknown) => ({
              maybeSingle: () => {
                const match = rows.find(r => r[col] === val);
                return Promise.resolve({ data: match ? { id: match.id } : null, error: null });
              },
            }),
          }),
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: () => {
                const dup = row.source_message_id != null && rows.some(r => r.source_message_id === row.source_message_id);
                if (dup) return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } });
                const id = `inbound${rows.length + 1}`;
                rows.push({ ...row, id });
                return Promise.resolve({ data: { id }, error: null });
              },
            }),
          }),
          // The claim inside draftForInboundEmail isn't under test here --
          // let it always "win" trivially.
          update: () => updateChain({ data: [{ id: 'x' }], error: null }),
        };
      }
      if (table === 'verticals') return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
      if (table === 'offer_versions') return { select: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { code: 'PGRST205', message: 'missing' } }) }) }) }) };
      if (table === 'email_reply_drafts') return { insert: () => Promise.resolve({ error: null }) };
      throw new Error(`Unexpected table in test: ${table}`);
    });
    return { client: { from } as unknown as SupabaseClient, rows };
  }

  beforeEach(() => {
    generateEmailReplyMock.mockReset();
    generateEmailReplyMock.mockResolvedValue(sampleDraft);
  });

  async function ingestFromPayload(client: SupabaseClient, payload: unknown) {
    const event = mapGhlInboundEmailPayload(payload);
    return ingestInboundEmail(client, {
      source: 'ghl',
      sourceMessageId: event.sourceMessageId,
      ghlContactId: event.contactId,
      ghlConversationId: event.conversationId,
      fromAddress: event.fromAddress,
      fromName: event.fromName,
      subject: event.subject,
      body: event.body!,
      receivedAt: event.receivedAt,
    });
  }

  it('collapses two identical no-id payload redeliveries into a single row', async () => {
    const { client, rows } = statefulFakeSupabase();
    const payload = { type: 'InboundMessage', messageType: 'Email', contactId: 'c1', subject: 'Question', body: 'Do you service my area?' };

    const result1 = await ingestFromPayload(client, payload);
    const result2 = await ingestFromPayload(client, { ...payload }); // GHL redelivers the identical payload

    expect(result1).toEqual({ ok: true, inserted: true, inboundEmailId: 'inbound1', drafted: true });
    expect(result2).toEqual({ ok: true, inserted: false, reason: expect.stringMatching(/duplicate/i) });
    expect(rows.length).toBe(1);
  });

  it('produces two rows when the redelivered payload has a different body', async () => {
    const { client, rows } = statefulFakeSupabase();
    const payloadA = { type: 'InboundMessage', messageType: 'Email', contactId: 'c1', subject: 'Question', body: 'Do you service my area?' };
    const payloadB = { type: 'InboundMessage', messageType: 'Email', contactId: 'c1', subject: 'Question', body: 'What about a different zip code?' };

    await ingestFromPayload(client, payloadA);
    await ingestFromPayload(client, payloadB);

    expect(rows.length).toBe(2);
  });
});
