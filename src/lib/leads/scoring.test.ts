// Coverage for the pure lead-scoring decisions: seasonPlay's month
// boundaries and the upsert decision table are the two explicitly-required
// targets; the candidate builders get happy-path + rejection coverage since
// they're the part most likely to silently mis-score a real GHL contact.

import { describe, it, expect } from 'vitest';
import {
  buildInboundAutoCreateFields,
  buildInboundCandidate,
  buildQuoteFollowupCandidate,
  buildSeasonPlayCandidate,
  decideUpsert,
  isFreshInquiry,
  isPastCustomer,
  isQuoteSentStage,
  matchesKeyword,
  seasonPlay,
  SCORE_INBOUND,
  SCORE_QUOTE_FOLLOWUP,
  SCORE_SEASON_PLAY,
  isCallable,
} from './scoring';
import type { HighLevelContact, HighLevelOpportunity } from '../ghl/types';

describe('seasonPlay', () => {
  it('is "permanent" for Jul 31 (the day before the rebook window opens)', () => {
    expect(seasonPlay(new Date(Date.UTC(2026, 6, 31)))).toBe('permanent');
  });

  it('is "rebook" starting Aug 1', () => {
    expect(seasonPlay(new Date(Date.UTC(2026, 7, 1)))).toBe('rebook');
  });

  it('is "rebook" through Nov 30 (the last day of the rebook window)', () => {
    expect(seasonPlay(new Date(Date.UTC(2026, 10, 30)))).toBe('rebook');
  });

  it('is "permanent" starting Dec 1', () => {
    expect(seasonPlay(new Date(Date.UTC(2026, 11, 1)))).toBe('permanent');
  });

  it('is "permanent" mid-window (e.g. March)', () => {
    expect(seasonPlay(new Date(Date.UTC(2026, 2, 15)))).toBe('permanent');
  });
});

describe('matchesKeyword', () => {
  it('matches a whole word case-insensitively', () => {
    expect(matchesKeyword('New Lead - Web Form', 'new')).toBe(true);
    expect(matchesKeyword('NEW LEAD', 'new')).toBe(true);
  });

  it('does not match "new" inside "renewed" (word boundary, not substring)', () => {
    expect(matchesKeyword('Renewed - Rebooked for 2026', 'new')).toBe(false);
  });

  it('returns false for null/undefined text', () => {
    expect(matchesKeyword(null, 'new')).toBe(false);
    expect(matchesKeyword(undefined, 'new')).toBe(false);
  });
});

describe('isFreshInquiry', () => {
  it('matches on a stage name keyword', () => {
    expect(isFreshInquiry('New Lead', [])).toBe(true);
    expect(isFreshInquiry('Quote Requested', [])).toBe(true);
  });

  it('matches on a tag keyword when the stage does not match', () => {
    expect(isFreshInquiry('Open', ['New Lead'])).toBe(true);
  });

  it('is false when neither stage nor tags suggest a fresh inquiry', () => {
    expect(isFreshInquiry('Open', ['vip'])).toBe(false);
  });
});

describe('isQuoteSentStage', () => {
  it('requires both a quote-ish word and a sent-ish word', () => {
    expect(isQuoteSentStage('Quote Sent')).toBe(true);
    expect(isQuoteSentStage('Estimate Delivered')).toBe(true);
  });

  it('is false when only one half is present', () => {
    expect(isQuoteSentStage('Quote Requested')).toBe(false);
    expect(isQuoteSentStage('Sent to Install')).toBe(false);
  });
});

describe('isPastCustomer', () => {
  it('matches a past-customer-ish tag', () => {
    expect(isPastCustomer(['Past Customer'])).toBe(true);
    expect(isPastCustomer(['Holiday Customer', 'vip'])).toBe(true);
  });

  it('does not match an unrelated tag', () => {
    expect(isPastCustomer(['vip', 'referral'])).toBe(false);
  });
});

function contact(overrides: Partial<HighLevelContact> = {}): HighLevelContact {
  return { id: 'c1', firstName: 'Jordan', lastName: 'Rivera', phone: '5551234567', tags: [], ...overrides };
}

describe('buildInboundCandidate', () => {
  const now = new Date('2026-08-15T12:00:00Z');

  it('builds a scored candidate for a fresh inquiry updated within 48h', () => {
    const result = buildInboundCandidate({
      contact: contact({ dateUpdated: '2026-08-14T12:00:00Z', tags: ['New Lead'] }),
      stageName: null,
      now,
    });
    expect(result).toMatchObject({
      ghl_contact_id: 'c1',
      full_name: 'Jordan Rivera',
      score: SCORE_INBOUND,
      source: 'inbound_speed',
      opener_hint: 'Inbound follow-up',
    });
    expect(result?.reason).toMatch(/Reached out .* - call back fast/);
  });

  it('returns null when the contact was not updated in the last 48h', () => {
    const result = buildInboundCandidate({
      contact: contact({ dateUpdated: '2026-08-01T12:00:00Z', tags: ['New Lead'] }),
      stageName: null,
      now,
    });
    expect(result).toBeNull();
  });

  it('returns null when nothing suggests a fresh inquiry', () => {
    const result = buildInboundCandidate({
      contact: contact({ dateUpdated: '2026-08-14T12:00:00Z', tags: ['vip'] }),
      stageName: 'Open',
      now,
    });
    expect(result).toBeNull();
  });
});

function opportunity(overrides: Partial<HighLevelOpportunity> = {}): HighLevelOpportunity {
  return { id: 'o1', contactId: 'c1', pipelineId: 'p1', status: 'open', ...overrides };
}

describe('buildQuoteFollowupCandidate', () => {
  const now = new Date('2026-08-15T12:00:00Z');
  const contactRef = { id: 'c1', name: 'Jordan Rivera', phone: '5551234567' };

  it('builds a scored candidate for a quote-sent stage older than 3 days', () => {
    const result = buildQuoteFollowupCandidate({
      opportunity: opportunity({ updatedAt: '2026-08-10T12:00:00Z' }),
      stageName: 'Quote Sent',
      contact: contactRef,
      now,
    });
    expect(result).toMatchObject({
      ghl_contact_id: 'c1',
      score: SCORE_QUOTE_FOLLOWUP,
      source: 'quote_followup',
      opener_hint: 'Quote follow-up',
      reason: 'Quote sent 5 days ago, no decision',
    });
  });

  it('returns null when the quote is less than 3 days old', () => {
    const result = buildQuoteFollowupCandidate({
      opportunity: opportunity({ updatedAt: '2026-08-14T12:00:00Z' }),
      stageName: 'Quote Sent',
      contact: contactRef,
      now,
    });
    expect(result).toBeNull();
  });

  it('returns null for a won or lost opportunity even if the stage still reads quote-sent', () => {
    const result = buildQuoteFollowupCandidate({
      opportunity: opportunity({ updatedAt: '2026-08-01T12:00:00Z', status: 'won' }),
      stageName: 'Quote Sent',
      contact: contactRef,
      now,
    });
    expect(result).toBeNull();
  });

  it('returns null when the stage is not a quote-sent stage', () => {
    const result = buildQuoteFollowupCandidate({
      opportunity: opportunity({ updatedAt: '2026-08-01T12:00:00Z' }),
      stageName: 'Scheduled',
      contact: contactRef,
      now,
    });
    expect(result).toBeNull();
  });
});

describe('buildSeasonPlayCandidate', () => {
  it('proposes a rebook for a past customer with no rebook signal, in rebook season', () => {
    const result = buildSeasonPlayCandidate({
      contact: contact({ tags: ['Past Customer'] }),
      openStageNames: [],
      play: 'rebook',
    });
    expect(result).toMatchObject({
      score: SCORE_SEASON_PLAY,
      source: 'season_play',
      reason: 'Rebook season - was a customer last year',
      vertical_slug: 'holiday',
    });
  });

  it('returns null for rebook season when the customer already rebooked', () => {
    const result = buildSeasonPlayCandidate({
      contact: contact({ tags: ['Past Customer', 'Rebooked'] }),
      openStageNames: [],
      play: 'rebook',
    });
    expect(result).toBeNull();
  });

  it('proposes a permanent-lighting upsell for a past customer with no permanent signal, off-season', () => {
    const result = buildSeasonPlayCandidate({
      contact: contact({ tags: ['Past Customer'] }),
      openStageNames: [],
      play: 'permanent',
    });
    expect(result).toMatchObject({
      score: SCORE_SEASON_PLAY,
      reason: 'Permanent lighting upsell candidate',
      vertical_slug: 'permanent',
    });
  });

  it('returns null off-season when the customer already has a permanent-lighting signal', () => {
    const result = buildSeasonPlayCandidate({
      contact: contact({ tags: ['Past Customer'] }),
      openStageNames: ['Permanent Install Scheduled'],
      play: 'permanent',
    });
    expect(result).toBeNull();
  });

  it('returns null when the contact has no past-customer signal at all', () => {
    const result = buildSeasonPlayCandidate({
      contact: contact({ tags: ['vip'] }),
      openStageNames: [],
      play: 'rebook',
    });
    expect(result).toBeNull();
  });
});

describe('decideUpsert', () => {
  it('inserts when no existing lead is found', () => {
    expect(decideUpsert(null)).toEqual({ action: 'insert' });
  });

  it('updates when the existing lead is still queued', () => {
    expect(decideUpsert({ id: 'lead1', status: 'queued' })).toEqual({ action: 'update', leadId: 'lead1' });
  });

  it('skips a claimed lead', () => {
    expect(decideUpsert({ id: 'lead1', status: 'claimed' })).toEqual({ action: 'skip' });
  });

  it('skips a done lead', () => {
    expect(decideUpsert({ id: 'lead1', status: 'done' })).toEqual({ action: 'skip' });
  });

  it('skips a dismissed lead (a rep decision a rebuild should not undo)', () => {
    expect(decideUpsert({ id: 'lead1', status: 'dismissed' })).toEqual({ action: 'skip' });
  });
});

describe('isCallable (do-not-call gate, live-verified stage vocabulary)', () => {
  it('blocks a dnd-flagged contact', () => {
    expect(isCallable({ dnd: true, tags: [], stageNames: [] })).toBe(false);
  });

  it('blocks DO NOT CALL / Spam Calls / Pause Communications stages', () => {
    expect(isCallable({ tags: [], stageNames: ['DO NOT CALL'] })).toBe(false);
    expect(isCallable({ tags: [], stageNames: ['Spam Calls'] })).toBe(false);
    expect(isCallable({ tags: [], stageNames: ['Pause Communications Until October'] })).toBe(false);
  });

  it('blocks a dnc tag', () => {
    expect(isCallable({ tags: ['DNC'], stageNames: [] })).toBe(false);
  });

  it('allows a normal contact', () => {
    expect(isCallable({ dnd: false, tags: ['past customer'], stageNames: ['Approved'] })).toBe(true);
  });
});

describe('live GHL stage vocabulary (verified 2026-07-08)', () => {
  it('isQuoteSentStage matches the real Bid Sent stages', () => {
    expect(isQuoteSentStage('Bid Sent')).toBe(true);
    expect(isQuoteSentStage('Sent Quote')).toBe(true);
    expect(isQuoteSentStage('Proposal Sent')).toBe(true);
    expect(isQuoteSentStage('Make Quote')).toBe(false);
  });

  it('isFreshInquiry matches Interested/Contacted without swallowing rebook stages', () => {
    expect(isFreshInquiry('Interested In Services', [])).toBe(true);
    expect(isFreshInquiry('Contacted', [])).toBe(true);
    expect(isFreshInquiry('Previous Year Open', [])).toBe(false);
  });

  it('isPastCustomer accepts the rebook-flavored stage names', () => {
    expect(isPastCustomer([], ['Previous Year Open'])).toBe(true);
    expect(isPastCustomer([], ['November Reengagement'])).toBe(true);
    expect(isPastCustomer([], ['End of Year'])).toBe(true);
    expect(isPastCustomer([], ['Open'])).toBe(false);
  });
});

// GET /api/inbound/recent's lazy lead auto-create — H2: a webhook-logged
// inbound call/text with no existing lead used to insert a plain 'queued'
// row with zero DNC check. buildInboundAutoCreateFields is the pure
// insert-shape decision the route now makes AFTER checking isCallable.
describe('buildInboundAutoCreateFields (inbound auto-create DNC gate)', () => {
  it('queues normally when the contact is confirmed callable', () => {
    expect(buildInboundAutoCreateFields(true)).toEqual({
      reason: 'Inbound call just now',
      opener_hint: 'Inbound follow-up',
      score: SCORE_INBOUND,
      source: 'inbound',
      status: 'queued',
    });
  });

  it('inserts a dismissed, DNC-flagged row when the contact is not callable (or unverifiable)', () => {
    const fields = buildInboundAutoCreateFields(false);
    expect(fields.status).toBe('dismissed');
    expect(fields.reason).toMatch(/^DNC - do not call back/);
    expect(fields.source).toBe('inbound');
    expect(fields.score).toBe(SCORE_INBOUND);
  });
});
