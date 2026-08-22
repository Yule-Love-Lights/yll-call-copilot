import { describe, expect, it } from 'vitest';
import { decideQuoteEvent, type QuoteEvent } from './quoteEventInbox';

const event = (overrides: Partial<QuoteEvent> = {}): QuoteEvent => ({
  event_id: 'event-1', event_type: 'QuoteSentRecorded', aggregate_id: 'quote-1',
  entity_version: 1, source_outbox_sequence: 1, actor_employee_id: null, ...overrides,
});

describe('decideQuoteEvent', () => {
  it('does not duplicate an already-durable event', () => {
    expect(decideQuoteEvent({ event: event(), alreadyReceived: true, highestAppliedEntityVersion: 1 })).toEqual({ kind: 'duplicate' });
  });

  it('quarantines stale versions and retries gaps without overwriting state', () => {
    expect(decideQuoteEvent({ event: event({ entity_version: 2 }), alreadyReceived: false, highestAppliedEntityVersion: 2 })).toEqual({ kind: 'stale', reason: 'older_entity_version' });
    expect(decideQuoteEvent({ event: event({ entity_version: 4 }), alreadyReceived: false, highestAppliedEntityVersion: 2 })).toEqual({ kind: 'retry', reason: 'entity_version_gap' });
  });

  it('creates a task only for explicit promise evidence', () => {
    expect(decideQuoteEvent({ event: event({ event_type: 'QuotePromiseRecorded', promise_id: 'promise-1', promise_type: 'provide_revision' }), alreadyReceived: false, highestAppliedEntityVersion: 0 })).toEqual({ kind: 'apply', createTask: true, taskTitle: 'Provide promised quote revision' });
    expect(decideQuoteEvent({ event: event({ event_type: 'QuoteSentRecorded' }), alreadyReceived: false, highestAppliedEntityVersion: 0 })).toEqual({ kind: 'apply', createTask: false });
  });
});
