// Pure validation for POST /api/calls's request body — the part of that
// route worth unit-testing without a live database, same split as
// transcripts/ingest.ts's selectNextBatch. The route itself does the
// sequential Supabase/Claude work and stays a thin, untested orchestrator,
// same convention as every other route in this app.

import { CALL_OUTCOMES, type CallOutcome } from './types';

// Loose UUID shape check, not a strict v4 validator — good enough to reject
// garbage before it reaches a `.eq('id', callId)` query. Matches the shape
// every id in this app already has (gen_random_uuid()).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CallInput = {
  leadId: string;
  outcome: CallOutcome;
  notes: string;
  // Trimmed; null means no transcript was pasted for this call.
  transcript: string | null;
  // Set when this outcome belongs to a call POST /api/live/end already
  // created (the rep just finished a live-coached call) — see
  // POST /api/calls, which UPDATEs that row instead of inserting a second
  // one. null for a plain outbound call logged straight from the console.
  callId: string | null;
};

export type CallInputValidation = { valid: true; input: CallInput } | { valid: false; error: string };

export function validateCallInput(body: unknown): CallInputValidation {
  if (typeof body !== 'object' || body === null) {
    return { valid: false, error: 'Invalid request body.' };
  }
  const b = body as Record<string, unknown>;

  const leadId = typeof b.leadId === 'string' ? b.leadId.trim() : '';
  if (!leadId) {
    return { valid: false, error: 'leadId is required.' };
  }

  const outcome = typeof b.outcome === 'string' ? b.outcome : '';
  if (!(CALL_OUTCOMES as string[]).includes(outcome)) {
    return { valid: false, error: `outcome must be one of: ${CALL_OUTCOMES.join(', ')}.` };
  }

  const notes = typeof b.notes === 'string' ? b.notes : '';
  const transcriptRaw = typeof b.transcript === 'string' ? b.transcript.trim() : '';

  const callIdRaw = typeof b.callId === 'string' ? b.callId.trim() : '';
  if (callIdRaw && !UUID_RE.test(callIdRaw)) {
    return { valid: false, error: 'callId must be a valid id.' };
  }

  return {
    valid: true,
    input: {
      leadId,
      outcome: outcome as CallOutcome,
      notes,
      transcript: transcriptRaw || null,
      callId: callIdRaw || null,
    },
  };
}
