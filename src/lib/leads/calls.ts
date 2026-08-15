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
  // Server-recovered pending live attempt. The database revalidates the
  // session-to-call-to-lead chain; null means a manual call completion.
  sessionId: string | null;
  // Stable across retries. The database uses this key to return the original
  // completed call instead of creating a second one after a lost response.
  completionRequestId: string;
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
  if (!UUID_RE.test(leadId)) {
    return { valid: false, error: 'leadId must be a valid id.' };
  }

  const outcome = typeof b.outcome === 'string' ? b.outcome : '';
  if (!(CALL_OUTCOMES as string[]).includes(outcome)) {
    return { valid: false, error: `outcome must be one of: ${CALL_OUTCOMES.join(', ')}.` };
  }

  const notes = typeof b.notes === 'string' ? b.notes : '';
  const transcriptRaw = typeof b.transcript === 'string' ? b.transcript.trim() : '';

  const sessionIdRaw = typeof b.sessionId === 'string' ? b.sessionId.trim() : '';
  if (sessionIdRaw && !UUID_RE.test(sessionIdRaw)) {
    return { valid: false, error: 'sessionId must be a valid id.' };
  }

  const completionRequestId = typeof b.completionRequestId === 'string' ? b.completionRequestId.trim() : '';
  if (!UUID_RE.test(completionRequestId)) {
    return { valid: false, error: 'completionRequestId must be a valid id.' };
  }

  return {
    valid: true,
    input: {
      leadId,
      outcome: outcome as CallOutcome,
      notes,
      transcript: transcriptRaw || null,
      sessionId: sessionIdRaw || null,
      completionRequestId,
    },
  };
}
