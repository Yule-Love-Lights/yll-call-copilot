// Coverage for the email-specific GHL conversation helpers: searching recent
// conversations for an inbound email and sending a reply into a specific
// conversation thread. Same mocking style as client.test.ts -- mock global
// fetch, no live HighLevel calls.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { searchRecentInboundEmails, sendEmailReply } from './email';

function mockFetchOnce(json: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
      text: async () => JSON.stringify(json),
    })),
  );
}

describe('GHL email helpers', () => {
  beforeEach(() => {
    process.env.HIGHLEVEL_API_KEY = 'test-key';
    process.env.HIGHLEVEL_LOCATION_ID = 'loc_1';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.HIGHLEVEL_API_KEY;
    delete process.env.HIGHLEVEL_LOCATION_ID;
  });

  describe('searchRecentInboundEmails', () => {
    it('returns [] when there are no conversations', async () => {
      mockFetchOnce({ conversations: [] });
      expect(await searchRecentInboundEmails()).toEqual([]);
    });

    it('skips a conversation whose last message type is not email', async () => {
      mockFetchOnce({ conversations: [{ id: 'convo1', contactId: 'c1', lastMessageType: 'SMS' }] });
      expect(await searchRecentInboundEmails()).toEqual([]);
    });

    it('skips a conversation missing an id or contactId', async () => {
      mockFetchOnce({ conversations: [{ lastMessageType: 'Email' }] });
      expect(await searchRecentInboundEmails()).toEqual([]);
    });
  });

  describe('sendEmailReply', () => {
    it('posts type Email with the conversationId threaded through', async () => {
      const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => ({
        ok: true,
        status: 200,
        json: async () => ({ messageId: 'm1' }),
        text: async () => '{}',
        _init: init,
      }));
      vi.stubGlobal('fetch', fetchSpy);

      const result = await sendEmailReply({ contactId: 'c1', conversationId: 'convo1', subject: 'Re: hi', html: '<p>hi</p>' });

      expect(result).toEqual({ messageId: 'm1' });
      const [, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body).toMatchObject({ type: 'Email', contactId: 'c1', conversationId: 'convo1', subject: 'Re: hi', html: '<p>hi</p>' });
    });

    it('omits conversationId when not given', async () => {
      mockFetchOnce({ messageId: 'm2' });
      const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => ({
        ok: true,
        status: 200,
        json: async () => ({ messageId: 'm2' }),
        text: async () => '{}',
        _init: init,
      }));
      vi.stubGlobal('fetch', fetchSpy);

      await sendEmailReply({ contactId: 'c1', subject: 'Re: hi', html: '<p>hi</p>' });

      const [, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse((init as RequestInit).body as string);
      expect('conversationId' in body).toBe(false);
    });
  });
});
