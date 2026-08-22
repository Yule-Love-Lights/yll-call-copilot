export type QuoteEvent = {
  event_id: string;
  event_type: string;
  aggregate_id: string;
  entity_version: number;
  source_outbox_sequence: number;
  actor_employee_id: string | null;
  promise_id?: string | null;
  promise_type?: 'send_quote' | 'provide_revision' | 'customer_follow_up' | null;
  promise_due_at?: string | null;
};

export type InboxDecision =
  | { kind: 'duplicate' }
  | { kind: 'stale'; reason: 'older_entity_version' }
  | { kind: 'retry'; reason: 'entity_version_gap' }
  | { kind: 'apply'; createTask: boolean; taskTitle?: string };

/** Decides only from canonical evidence. It never infers an owner or task. */
export function decideQuoteEvent(input: {
  event: QuoteEvent;
  alreadyReceived: boolean;
  highestAppliedEntityVersion: number | null;
}): InboxDecision {
  const { event, alreadyReceived, highestAppliedEntityVersion } = input;
  if (alreadyReceived) return { kind: 'duplicate' };
  if (highestAppliedEntityVersion !== null && event.entity_version <= highestAppliedEntityVersion) {
    return { kind: 'stale', reason: 'older_entity_version' };
  }
  if (highestAppliedEntityVersion !== null && event.entity_version !== highestAppliedEntityVersion + 1) {
    return { kind: 'retry', reason: 'entity_version_gap' };
  }
  const taskTitle = quotePromiseTaskTitle(event);
  return taskTitle ? { kind: 'apply', createTask: true, taskTitle } : { kind: 'apply', createTask: false };
}

function quotePromiseTaskTitle(event: QuoteEvent): string | null {
  if (event.event_type !== 'QuotePromiseRecorded' || !event.promise_id || !event.promise_type) return null;
  switch (event.promise_type) {
    case 'send_quote': return 'Send promised quote';
    case 'provide_revision': return 'Provide promised quote revision';
    case 'customer_follow_up': return 'Complete promised customer follow-up';
  }
}
