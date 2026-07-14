// Coverage for the Workstream 7 GHL helpers: the pure crew-list parsing +
// phone-number detection, and resolveCrewContactIds's phone->contact
// resolution (mocked fetch, same style as client.test.ts -- no live
// HighLevel calls).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getWonOpportunities, looksLikePhoneNumber, parseCrewList, resolveCrewContactIds } from './secondMile';

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

describe('parseCrewList', () => {
  it('splits, trims, and dedupes a comma list', () => {
    expect(parseCrewList('c_1, c_2 ,c_1, c_3')).toEqual(['c_1', 'c_2', 'c_3']);
  });

  it('returns an empty array for null/undefined/empty', () => {
    expect(parseCrewList(null)).toEqual([]);
    expect(parseCrewList(undefined)).toEqual([]);
    expect(parseCrewList('')).toEqual([]);
  });

  it('drops empty entries from trailing/double commas', () => {
    expect(parseCrewList('c_1,,  ,c_2,')).toEqual(['c_1', 'c_2']);
  });
});

describe('looksLikePhoneNumber', () => {
  it('recognizes common phone formats', () => {
    expect(looksLikePhoneNumber('555-0100')).toBe(false); // too short to be a real phone (7+ digits)
    expect(looksLikePhoneNumber('555-0100x')).toBe(false);
    expect(looksLikePhoneNumber('(555) 010-0199')).toBe(true);
    expect(looksLikePhoneNumber('+15550100199')).toBe(true);
    expect(looksLikePhoneNumber('5550100199')).toBe(true);
  });

  it('does not treat a GHL contact id as a phone number', () => {
    expect(looksLikePhoneNumber('cnt_ab12cd34ef56')).toBe(false);
  });
});

describe('resolveCrewContactIds', () => {
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

  it('passes a non-phone entry through unresolved as an existing contact id', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const ids = await resolveCrewContactIds('cnt_ab12cd34ef56');

    expect(ids).toEqual(['cnt_ab12cd34ef56']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resolves a phone-number entry to the first matching GHL contact', async () => {
    mockFetchOnce({ contacts: [{ id: 'cnt_resolved' }] });

    const ids = await resolveCrewContactIds('(555) 010-0199');

    expect(ids).toEqual(['cnt_resolved']);
  });

  it('skips a phone entry that resolves to no contact', async () => {
    mockFetchOnce({ contacts: [] });

    const ids = await resolveCrewContactIds('(555) 010-0199');

    expect(ids).toEqual([]);
  });

  it('returns an empty array when the env var is unset', async () => {
    delete process.env.HIGHLEVEL_API_KEY;
    delete process.env.HIGHLEVEL_LOCATION_ID;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    expect(await resolveCrewContactIds(undefined)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('getWonOpportunities', () => {
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

  it('degrades to an empty array when HighLevel is not configured', async () => {
    delete process.env.HIGHLEVEL_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    expect(await getWonOpportunities()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches opportunities filtered to status=won', async () => {
    const fetchSpy = vi.fn(async (_input: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ opportunities: [{ id: 'o1', contactId: 'c1', pipelineId: 'p1', status: 'won' }] }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await getWonOpportunities();

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('won');
    const calledUrl = fetchSpy.mock.calls[0][0];
    expect(calledUrl).toContain('status=won');
  });
});
