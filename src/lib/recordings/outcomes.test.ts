// Coverage for the recording outcome matcher: the pure phone/status helpers,
// then the priority logic (Quote Tool win short-circuits; else GHL stage;
// else unknown) with every client mocked. Mocking style mirrors
// src/lib/transcripts/outcomes.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const getOpportunitiesForContactMock = vi.fn();
const getStageNameMapMock = vi.fn();
vi.mock('../ghl/client', () => ({
  getOpportunitiesForContact: (...args: unknown[]) => getOpportunitiesForContactMock(...args),
  getStageNameMap: (...args: unknown[]) => getStageNameMapMock(...args),
}));

const isQuoteToolConfiguredMock = vi.fn();
const getQuoteToolClientMock = vi.fn();
vi.mock('../quoteTool', () => ({
  isQuoteToolConfigured: (...args: unknown[]) => isQuoteToolConfiguredMock(...args),
  getQuoteToolClient: (...args: unknown[]) => getQuoteToolClientMock(...args),
}));

import { hasWonQuoteStatus, matchRecordingOutcome, phoneDigitsMatch } from './outcomes';

describe('phoneDigitsMatch', () => {
  it('matches the same number in different formats', () => {
    expect(phoneDigitsMatch('5551234567', '+1 (555) 123-4567')).toBe(true);
  });

  it('does not match different numbers', () => {
    expect(phoneDigitsMatch('5551234567', '5559998888')).toBe(false);
  });

  it('is false when either side is too short to be a real number', () => {
    expect(phoneDigitsMatch('123', '5551234567')).toBe(false);
    expect(phoneDigitsMatch(null, '5551234567')).toBe(false);
  });
});

describe('hasWonQuoteStatus', () => {
  it('is true when any status is approved or booked', () => {
    expect(hasWonQuoteStatus(['draft', 'approved'])).toBe(true);
    expect(hasWonQuoteStatus(['booked'])).toBe(true);
  });

  it('is false for declined/draft-only statuses or an empty list', () => {
    expect(hasWonQuoteStatus(['draft', 'declined'])).toBe(false);
    expect(hasWonQuoteStatus([])).toBe(false);
    expect(hasWonQuoteStatus([null, undefined])).toBe(false);
  });
});

// A minimal chainable fake for the Quote Tool's Supabase client — just
// enough of the query builder shape (.from().select().or().limit()) that
// findQuoteToolStatuses actually calls.
function fakeQuoteToolClient(rows: { status: string | null; customer_phone: string | null; customer_email: string | null }[]) {
  return {
    from: () => ({
      select: () => ({
        or: () => ({
          limit: async () => ({ data: rows, error: null }),
        }),
      }),
    }),
  };
}

describe('matchRecordingOutcome', () => {
  beforeEach(() => {
    getOpportunitiesForContactMock.mockReset();
    getStageNameMapMock.mockReset();
    isQuoteToolConfiguredMock.mockReset();
    getQuoteToolClientMock.mockReset();
  });

  it('returns booked from the Quote Tool when a matched quote is approved, without touching GHL', async () => {
    isQuoteToolConfiguredMock.mockReturnValue(true);
    getQuoteToolClientMock.mockReturnValue(
      fakeQuoteToolClient([{ status: 'approved', customer_phone: '5551234567', customer_email: null }]),
    );

    const result = await matchRecordingOutcome({ customer_phone: '5551234567', ghl_contact_id: 'c1' });

    expect(result).toEqual({ outcome: 'booked', outcome_source: 'quote_tool' });
    expect(getOpportunitiesForContactMock).not.toHaveBeenCalled();
  });

  it('falls back to the GHL stage when the Quote Tool has no win', async () => {
    isQuoteToolConfiguredMock.mockReturnValue(true);
    getQuoteToolClientMock.mockReturnValue(
      fakeQuoteToolClient([{ status: 'draft', customer_phone: '5551234567', customer_email: null }]),
    );
    getOpportunitiesForContactMock.mockResolvedValueOnce([
      { id: 'o1', contactId: 'c1', pipelineId: 'p1', pipelineStageId: 's1' },
    ]);
    getStageNameMapMock.mockResolvedValueOnce(new Map([['s1', 'Won']]));

    const result = await matchRecordingOutcome({ customer_phone: '5551234567', ghl_contact_id: 'c1' });

    expect(result).toEqual({ outcome: 'booked', outcome_source: 'ghl_stage:Won' });
  });

  it('skips the Quote Tool lookup entirely when unconfigured', async () => {
    isQuoteToolConfiguredMock.mockReturnValue(false);
    getOpportunitiesForContactMock.mockResolvedValueOnce([]);

    const result = await matchRecordingOutcome({ customer_phone: '5551234567', ghl_contact_id: 'c1' });

    expect(getQuoteToolClientMock).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: 'unknown', outcome_source: null });
  });

  it('returns unknown when neither source classifies the call', async () => {
    isQuoteToolConfiguredMock.mockReturnValue(false);
    getOpportunitiesForContactMock.mockResolvedValueOnce([
      { id: 'o1', contactId: 'c1', pipelineId: 'p1', pipelineStageId: 's9' },
    ]);
    getStageNameMapMock.mockResolvedValueOnce(new Map([['s9', 'Open']]));

    const result = await matchRecordingOutcome({ customer_phone: null, ghl_contact_id: 'c1' });

    expect(result).toEqual({ outcome: 'unknown', outcome_source: null });
  });

  it('degrades to the GHL stage when the Quote Tool lookup throws', async () => {
    isQuoteToolConfiguredMock.mockReturnValue(true);
    getQuoteToolClientMock.mockReturnValue({
      from: () => ({
        select: () => ({
          or: () => ({
            limit: async () => {
              throw new Error('network error');
            },
          }),
        }),
      }),
    });
    getOpportunitiesForContactMock.mockResolvedValueOnce([
      { id: 'o1', contactId: 'c1', pipelineId: 'p1', pipelineStageId: 's1' },
    ]);
    getStageNameMapMock.mockResolvedValueOnce(new Map([['s1', 'Lost']]));

    const result = await matchRecordingOutcome({ customer_phone: '5551234567', ghl_contact_id: 'c1' });

    expect(result).toEqual({ outcome: 'not_booked', outcome_source: 'ghl_stage:Lost' });
  });

  it('returns unknown with no GHL contact id and no Quote Tool win', async () => {
    isQuoteToolConfiguredMock.mockReturnValue(false);

    const result = await matchRecordingOutcome({ customer_phone: null, ghl_contact_id: null });

    expect(getOpportunitiesForContactMock).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: 'unknown', outcome_source: null });
  });
});
