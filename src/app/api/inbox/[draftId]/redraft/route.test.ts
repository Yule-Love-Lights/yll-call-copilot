// Coverage for the FIX-4 adaptation of POST /api/inbox/[draftId]/redraft:
// draftForInboundEmail (src/lib/email/ingest.ts) now claims the inbound_email
// row with a status 'new' -> 'drafted' conditional update, so a redraft
// target (normally already 'drafted' from the first successful draft) must
// be reset to 'new' before calling it, or the claim would never match and
// every redraft would silently no-op. draftForInboundEmail itself is mocked
// here -- its claim/revert behavior is covered directly in ingest.test.ts;
// this file only covers the route's own orchestration (reset-before-claim,
// superseding the prior draft, and no longer doing its own revert-to-'new').

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const getSupabaseServerClientMock = vi.fn();
const isSupabaseConfiguredMock = vi.fn();
const isMissingTableErrorMock = vi.fn(() => false);

vi.mock('@/lib/supabase', () => ({
  getSupabaseServerClient: () => getSupabaseServerClientMock(),
  isSupabaseConfigured: () => isSupabaseConfiguredMock(),
  isMissingTableError: () => isMissingTableErrorMock(),
}));

const draftForInboundEmailMock = vi.fn();
vi.mock('@/lib/email/ingest', () => ({
  draftForInboundEmail: (...args: unknown[]) => draftForInboundEmailMock(...args),
}));

import { POST } from './route';

function fakeSupabase(draftStatus: string) {
  const updated: { table: string; row: Record<string, unknown> }[] = [];

  const from = vi.fn((table: string) => {
    if (table === 'email_reply_drafts') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: { id: 'draft1', inbound_email_id: 'inbound1', status: draftStatus }, error: null }),
          }),
        }),
        update: (row: Record<string, unknown>) => {
          updated.push({ table, row });
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    }
    if (table === 'inbound_emails') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: { id: 'inbound1', subject: 'hi', body: 'hello', from_name: 'Alex' }, error: null }),
          }),
        }),
        update: (row: Record<string, unknown>) => {
          updated.push({ table, row });
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return { client: { from } as unknown as SupabaseClient, updated };
}

describe('POST /api/inbox/[draftId]/redraft', () => {
  beforeEach(() => {
    isSupabaseConfiguredMock.mockReturnValue(true);
    draftForInboundEmailMock.mockReset();
  });

  it('resets the inbound email to \'new\' before calling draftForInboundEmail, so its claim can succeed', async () => {
    const { client, updated } = fakeSupabase('draft');
    getSupabaseServerClientMock.mockReturnValue(client);
    draftForInboundEmailMock.mockResolvedValue({ ok: true });

    const res = await POST(new Request('http://localhost/api/inbox/draft1/redraft', { method: 'POST' }), {
      params: Promise.resolve({ draftId: 'draft1' }),
    });
    const json = await res.json();

    expect(json).toEqual({ configured: true, redrafted: true });
    // Superseded the old active draft, then reset the parent row to 'new'
    // BEFORE draftForInboundEmail was called (order matters: the claim
    // inside it only matches status='new').
    const inboundUpdates = updated.filter(u => u.table === 'inbound_emails');
    expect(inboundUpdates).toEqual([{ table: 'inbound_emails', row: { status: 'new' } }]);
    expect(draftForInboundEmailMock).toHaveBeenCalledWith(client, { id: 'inbound1', subject: 'hi', body: 'hello', from_name: 'Alex' });

    const draftUpdates = updated.filter(u => u.table === 'email_reply_drafts');
    expect(draftUpdates).toEqual([{ table: 'email_reply_drafts', row: { status: 'dismissed' } }]);
  });

  it('does not supersede a draft that is already sent/failed/dismissed, but still resets and redrafts', async () => {
    const { client, updated } = fakeSupabase('sent');
    getSupabaseServerClientMock.mockReturnValue(client);
    draftForInboundEmailMock.mockResolvedValue({ ok: true });

    await POST(new Request('http://localhost/api/inbox/draft1/redraft', { method: 'POST' }), {
      params: Promise.resolve({ draftId: 'draft1' }),
    });

    expect(updated.filter(u => u.table === 'email_reply_drafts')).toEqual([]);
    expect(updated.filter(u => u.table === 'inbound_emails')).toEqual([{ table: 'inbound_emails', row: { status: 'new' } }]);
  });

  it('surfaces the error and does not perform its own revert when draftForInboundEmail fails (it owns the revert now)', async () => {
    const { client, updated } = fakeSupabase('draft');
    getSupabaseServerClientMock.mockReturnValue(client);
    draftForInboundEmailMock.mockResolvedValue({ ok: false, error: 'Claude not configured.' });

    const res = await POST(new Request('http://localhost/api/inbox/draft1/redraft', { method: 'POST' }), {
      params: Promise.resolve({ draftId: 'draft1' }),
    });
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json).toEqual({ configured: true, redrafted: false, error: 'Claude not configured.' });
    // Only the one reset-to-'new' update before the call -- no second
    // "revert to new" update after the failure (draftForInboundEmail owns
    // that now).
    expect(updated.filter(u => u.table === 'inbound_emails')).toEqual([{ table: 'inbound_emails', row: { status: 'new' } }]);
  });
});
