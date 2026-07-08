// Coverage for matchOutcome and its stage-name keyword classification.
// Mocks the GHL client (../ghl/client) — no live HighLevel calls, same
// mocking style as src/lib/ghl/client.test.ts uses for fetch.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CrmContact } from '../ghl/types';

const searchContactsMock = vi.fn();
const getOpportunitiesForContactMock = vi.fn();
const getStageNameMapMock = vi.fn();

vi.mock('../ghl/client', () => ({
  searchContacts: (...args: unknown[]) => searchContactsMock(...args),
  getOpportunitiesForContact: (...args: unknown[]) => getOpportunitiesForContactMock(...args),
  getStageNameMap: (...args: unknown[]) => getStageNameMapMock(...args),
}));

import { classifyStageName, matchOutcome } from './outcomes';

function contact(id: string): CrmContact {
  return { id, source: 'highlevel' };
}

describe('classifyStageName', () => {
  it('classifies a "signed"/"won"/"booked" stage as booked', () => {
    expect(classifyStageName('Signed - Job Booked')).toBe('booked');
    expect(classifyStageName('Won')).toBe('booked');
    expect(classifyStageName('Booked for install')).toBe('booked');
  });

  it('classifies a "lost"/"dead"/"not" stage as not_booked', () => {
    expect(classifyStageName('Lost')).toBe('not_booked');
    expect(classifyStageName('Dead Lead')).toBe('not_booked');
    expect(classifyStageName('Not Interested')).toBe('not_booked');
  });

  it('is case-insensitive', () => {
    expect(classifyStageName('SIGNED')).toBe('booked');
  });

  it('returns null for a stage name with no recognized keyword', () => {
    expect(classifyStageName('Open')).toBeNull();
    expect(classifyStageName('Make Quote')).toBeNull();
  });
});

describe('matchOutcome', () => {
  beforeEach(() => {
    searchContactsMock.mockReset();
    getOpportunitiesForContactMock.mockReset();
    getStageNameMapMock.mockReset();
  });

  it('returns unknown with no GHL calls when neither phone nor name is provided', async () => {
    const result = await matchOutcome({});
    expect(result).toEqual({ outcome: 'unknown', outcome_source: null, ghl_contact_id: null });
    expect(searchContactsMock).not.toHaveBeenCalled();
  });

  it('searches by phone first and classifies a booked stage', async () => {
    searchContactsMock.mockResolvedValueOnce([contact('c1')]);
    getOpportunitiesForContactMock.mockResolvedValueOnce([{ id: 'o1', contactId: 'c1', pipelineId: 'p1', pipelineStageId: 's1' }]);
    const stageNames = new Map([['s1', 'Signed - Job Booked']]);

    const result = await matchOutcome({ customer_phone: '5551234567', customer_name: 'Someone' }, stageNames);

    expect(searchContactsMock).toHaveBeenCalledTimes(1);
    expect(searchContactsMock).toHaveBeenCalledWith('5551234567');
    expect(result).toEqual({ outcome: 'booked', outcome_source: 'stage:Signed - Job Booked', ghl_contact_id: 'c1' });
  });

  it('falls back to searching by name when the phone search finds nothing', async () => {
    searchContactsMock.mockResolvedValueOnce([]); // phone search
    searchContactsMock.mockResolvedValueOnce([contact('c2')]); // name search
    getOpportunitiesForContactMock.mockResolvedValueOnce([{ id: 'o1', contactId: 'c2', pipelineId: 'p1', pipelineStageId: 's2' }]);
    const stageNames = new Map([['s2', 'Lost - Not Interested']]);

    const result = await matchOutcome({ customer_phone: '5550000000', customer_name: 'Jamie Lee' }, stageNames);

    expect(searchContactsMock).toHaveBeenCalledTimes(2);
    expect(searchContactsMock).toHaveBeenNthCalledWith(2, 'Jamie Lee');
    expect(result.outcome).toBe('not_booked');
    expect(result.ghl_contact_id).toBe('c2');
  });

  it('returns unknown with the contact id when a contact has no opportunities', async () => {
    searchContactsMock.mockResolvedValueOnce([contact('c3')]);
    getOpportunitiesForContactMock.mockResolvedValueOnce([]);

    const result = await matchOutcome({ customer_phone: '5551112222' }, new Map());

    expect(result).toEqual({ outcome: 'unknown', outcome_source: 'no_opportunity', ghl_contact_id: 'c3' });
  });

  it('returns unknown with the contact id when no opportunity stage is classifiable', async () => {
    searchContactsMock.mockResolvedValueOnce([contact('c4')]);
    getOpportunitiesForContactMock.mockResolvedValueOnce([{ id: 'o1', contactId: 'c4', pipelineId: 'p1', pipelineStageId: 's9' }]);
    const stageNames = new Map([['s9', 'Open']]);

    const result = await matchOutcome({ customer_phone: '5553334444' }, stageNames);

    expect(result).toEqual({ outcome: 'unknown', outcome_source: 'no_clear_stage', ghl_contact_id: 'c4' });
  });

  it('returns unknown with no contact id when no contact is found at all', async () => {
    searchContactsMock.mockResolvedValueOnce([]);
    searchContactsMock.mockResolvedValueOnce([]);

    const result = await matchOutcome({ customer_phone: '5550000000', customer_name: 'Nobody' });

    expect(result).toEqual({ outcome: 'unknown', outcome_source: null, ghl_contact_id: null });
  });

  it('fetches the stage-name map itself when none is passed in', async () => {
    searchContactsMock.mockResolvedValueOnce([contact('c5')]);
    getOpportunitiesForContactMock.mockResolvedValueOnce([{ id: 'o1', contactId: 'c5', pipelineId: 'p1', pipelineStageId: 's1' }]);
    getStageNameMapMock.mockResolvedValueOnce(new Map([['s1', 'Won']]));

    const result = await matchOutcome({ customer_phone: '5559998888' });

    expect(getStageNameMapMock).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe('booked');
  });

  it('degrades to unknown/ghl_error instead of throwing when GHL fails', async () => {
    searchContactsMock.mockRejectedValueOnce(new Error('HighLevel is down'));

    const result = await matchOutcome({ customer_phone: '5551230000' });

    expect(result).toEqual({ outcome: 'unknown', outcome_source: 'ghl_error', ghl_contact_id: null });
  });
});
