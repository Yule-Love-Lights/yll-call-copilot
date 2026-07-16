// Coverage for the two gate refusals the brief calls out for
// POST /api/inbox/[draftId]/send -- GHL_SEND_ENABLED off, and a non-'draft'
// status guard. This route is a byte-for-byte-shape clone of
// POST /api/followups/[id]/send (which itself has no direct test file --
// this repo tests route logic at the lib layer and leaves thin route
// handlers untested elsewhere); these two tests exist because the brief
// asks for them explicitly, kept minimal on purpose.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const getSupabaseServerClientMock = vi.fn();
const isSupabaseConfiguredMock = vi.fn();
const isMissingTableErrorMock = vi.fn(() => false);

vi.mock('@/lib/supabase', () => ({
  getSupabaseServerClient: () => getSupabaseServerClientMock(),
  isSupabaseConfigured: () => isSupabaseConfiguredMock(),
  isMissingTableError: () => isMissingTableErrorMock(),
}));

const isHighLevelConfiguredMock = vi.fn(() => true);
vi.mock('@/lib/ghl/client', () => ({
  isHighLevelConfigured: () => isHighLevelConfiguredMock(),
  HighLevelError: class HighLevelError extends Error {},
}));

const sendEmailReplyMock = vi.fn();
vi.mock('@/lib/ghl/email', () => ({
  sendEmailReply: (...args: unknown[]) => sendEmailReplyMock(...args),
}));

import { POST } from './route';

function fakeSupabaseWithDraft(status: string) {
  const from = vi.fn((table: string) => {
    if (table === 'email_reply_drafts') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { id: 'draft1', inbound_email_id: 'inbound1', subject: 'Re: hi', body: 'hello', status },
                error: null,
              }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });
  return { from } as unknown as SupabaseClient;
}

describe('POST /api/inbox/[draftId]/send gate refusals', () => {
  beforeEach(() => {
    isSupabaseConfiguredMock.mockReturnValue(true);
    getSupabaseServerClientMock.mockReturnValue(fakeSupabaseWithDraft('draft'));
    sendEmailReplyMock.mockReset();
  });

  afterEach(() => {
    delete process.env.GHL_SEND_ENABLED;
  });

  it('refuses to send when GHL_SEND_ENABLED is not "true"', async () => {
    delete process.env.GHL_SEND_ENABLED;

    const res = await POST(new Request('http://localhost/api/inbox/draft1/send', { method: 'POST' }), {
      params: Promise.resolve({ draftId: 'draft1' }),
    });
    const json = await res.json();

    expect(json).toEqual({
      configured: true,
      sent: false,
      reason: 'Sending disabled - set GHL_SEND_ENABLED=true',
    });
    expect(sendEmailReplyMock).not.toHaveBeenCalled();
  });

  it('refuses a draft that is not in "draft" status (already sent/failed/dismissed)', async () => {
    process.env.GHL_SEND_ENABLED = 'true';
    getSupabaseServerClientMock.mockReturnValue(fakeSupabaseWithDraft('sent'));

    const res = await POST(new Request('http://localhost/api/inbox/draft1/send', { method: 'POST' }), {
      params: Promise.resolve({ draftId: 'draft1' }),
    });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.sent).toBe(false);
    expect(json.error).toMatch(/already sent, failed, or dismissed/i);
    expect(sendEmailReplyMock).not.toHaveBeenCalled();
  });
});
