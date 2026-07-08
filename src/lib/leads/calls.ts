// Pure validation for POST /api/calls's request body — the part of that
// route worth unit-testing without a live database, same split as
// transcripts/ingest.ts's selectNextBatch. The route itself does the
// sequential Supabase/Claude work and stays a thin, untested orchestrator,
// same convention as every other route in this app.

import { CALL_OUTCOMES, type CallOutcome } from './types';

export type CallInput = {
  leadId: string;
  outcome: CallOutcome;
  notes: string;
  // Trimmed; null means no transcript was pasted for this call.
  transcript: string | null;
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

  return {
    valid: true,
    input: { leadId, outcome: outcome as CallOutcome, notes, transcript: transcriptRaw || null },
  };
}
