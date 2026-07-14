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

import { ingestInboundEmail } from './ingest';

const sampleDraft = { intent: 'question', subject: 'Re: hi', body: 'Yes we do!', guarantee_used: 'all_inclusive' };

type FakeOpts = {
  existingInboundEmail?: { id: string } | null;
  existingCheckError?: { code?: string; message: string } | null;
  insertError?: { code?: string; message: string } | null;
};

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
          return { eq: () => Promise.resolve({ error: null }) };
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
    expect(updated).toEqual([{ intent: sampleDraft.intent, status: 'drafted' }]);
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
    expect(updated).toEqual([]);
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
