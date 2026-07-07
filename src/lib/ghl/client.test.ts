// Coverage for the ported GHL client (Phase 0): searchContacts + getContact.
// Style ported from the AI Quote Tool's highlevel.test.ts — we mock global
// fetch + the required env vars; no live HighLevel calls.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HighLevelError, getContact, isHighLevelConfigured, searchContacts } from './client';
import type { HighLevelContact } from './types';

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

describe('GHL client', () => {
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

  describe('isHighLevelConfigured', () => {
    it('is true when both env vars are set', () => {
      expect(isHighLevelConfigured()).toBe(true);
    });

    it('is false when a required env var is missing', () => {
      delete process.env.HIGHLEVEL_LOCATION_ID;
      expect(isHighLevelConfigured()).toBe(false);
    });
  });

  describe('searchContacts (happy path)', () => {
    it('maps HighLevel contacts into the redacted CrmContact shape', async () => {
      const hl: HighLevelContact = {
        id: 'c1',
        firstName: 'Jordan',
        lastName: 'Rivera',
        email: 'jordan@example.com',
        customFields: [{ id: 'cf1', value: 'secret' }],
        tags: ['vip'],
      };
      mockFetchOnce({ contacts: [hl] });

      const [contact] = await searchContacts('jordan');

      expect(contact).toBeDefined();
      expect(contact.firstName).toBe('Jordan');
      expect(contact.fullName).toBe('Jordan Rivera');
      expect('raw' in contact).toBe(false);
    });

    it('returns an empty array for a blank query without calling fetch', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      expect(await searchContacts('   ')).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('getContact (happy path)', () => {
    it('fetches and maps a single contact by id', async () => {
      const hl: HighLevelContact = { id: 'c1', contactName: 'Jordan Rivera', phone: '555-0100' };
      mockFetchOnce({ contact: hl });

      const contact = await getContact('c1');

      expect(contact.id).toBe('c1');
      expect(contact.fullName).toBe('Jordan Rivera');
      expect(contact.phone).toBe('555-0100');
    });
  });

  describe('not configured', () => {
    it('throws HighLevelError when the required env vars are missing', async () => {
      delete process.env.HIGHLEVEL_API_KEY;
      delete process.env.HIGHLEVEL_LOCATION_ID;

      await expect(searchContacts('jordan')).rejects.toThrow(HighLevelError);
    });
  });

  describe('non-200 response', () => {
    it('throws HighLevelError with the status attached', async () => {
      mockFetchOnce({ message: 'not found' }, 404);

      await expect(getContact('missing')).rejects.toMatchObject({
        name: 'HighLevelError',
        status: 404,
      });
    });
  });
});
