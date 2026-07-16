// Outcome labeling for a GHL call recording (Workstream 1). Two sources, in
// priority order:
//   (a) the AI Quote Tool's own database -- a quote for the same customer
//       (matched by phone digits and/or email) that reached an
//       approved/booked status. This is the strongest signal (the team's
//       actual money system), so it's checked first and short-circuits the
//       rest when it finds a win.
//   (b) the GHL pipeline stage for the contact's opportunities, reusing
//       classifyStageName from src/lib/transcripts/outcomes.ts -- the SAME
//       keyword classification the transcript-upload path already uses, so
//       there is only one "what stage name means booked" mapping in the
//       app, not two. Unlike that module's matchOutcome(), this never
//       searches GHL for a contact by phone/name first: a GHL-sourced call
//       recording already carries the real ghl_contact_id straight off the
//       call message, so there is nothing to guess at.
// Neither source found -> 'unknown'. Every step is best-effort: a failure
// in either source degrades toward the next source (or 'unknown'), never
// throws, same philosophy as matchOutcome().

import { getOpportunitiesForContact, getStageNameMap } from '../ghl/client';
import { classifyStageName } from '../transcripts/outcomes';
import type { TranscriptOutcome } from '../transcripts/types';
import { getQuoteToolClient, isQuoteToolConfigured } from '../quoteTool';

export type OutcomeMatch = {
  outcome: TranscriptOutcome;
  outcome_source: string | null;
};

export type MatchableRecording = {
  ghl_contact_id?: string | null;
  // Digits-only, same normalization as parse.ts's normalizePhone -- the
  // Quote Tool's customer_phone column is not guaranteed to be stored in
  // that exact shape, so the digit-level match below re-normalizes both
  // sides before comparing.
  customer_phone?: string | null;
  customer_email?: string | null;
};

// A quote reaching either of these statuses (src/lib/quoteStatus.ts in the
// AI Quote Tool repo) means the customer said yes: 'approved' is the
// customer's signed approval, 'booked' is the deposit-paid confirmation.
const WON_QUOTE_STATUSES = new Set(['approved', 'booked']);

function onlyDigits(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '');
}

// Exported for tests. Compares the last 10 digits so a stored "+15551234567"
// still matches a normalized "5551234567" regardless of a leading country
// code on either side.
export function phoneDigitsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = onlyDigits(a);
  const db = onlyDigits(b);
  if (da.length < 10 || db.length < 10) return false;
  return da.slice(-10) === db.slice(-10);
}

// Exported for tests. A recording counts as 'booked' via the Quote Tool the
// moment ANY matched quote reached a won status -- a customer can have an
// older declined quote and a newer approved one, and the win is what
// matters for outcome labeling.
export function hasWonQuoteStatus(statuses: (string | null | undefined)[]): boolean {
  return statuses.some(s => !!s && WON_QUOTE_STATUSES.has(s));
}

type QuoteToolRow = { status: string | null; customer_phone: string | null; customer_email: string | null };

async function findQuoteToolStatuses(phone: string | null | undefined, email: string | null | undefined): Promise<string[]> {
  const client = getQuoteToolClient();
  if (!client) return [];

  const filters: string[] = [];
  if (email) filters.push(`customer_email.eq.${email}`);
  const digits = onlyDigits(phone);
  if (digits.length >= 10) filters.push(`customer_phone.ilike.%${digits.slice(-10)}%`);
  if (filters.length === 0) return [];

  try {
    const { data, error } = await client
      .from('quotes')
      .select('status, customer_phone, customer_email')
      .or(filters.join(','))
      .limit(25);
    if (error) throw error;
    const rows = (data ?? []) as QuoteToolRow[];
    // The ilike above is a coarse pre-filter (a 10-digit suffix collision is
    // astronomically unlikely but not impossible); re-verify at the digit
    // level, or trust an exact email match outright.
    return rows
      .filter(r => (email && r.customer_email === email) || phoneDigitsMatch(r.customer_phone, phone))
      .map(r => r.status)
      .filter((s): s is string => !!s);
  } catch (err) {
    console.error('Quote Tool outcome lookup failed:', err);
    return [];
  }
}

export async function matchRecordingOutcome(
  input: MatchableRecording,
  stageNames?: Map<string, string>,
): Promise<OutcomeMatch> {
  if (isQuoteToolConfigured()) {
    const statuses = await findQuoteToolStatuses(input.customer_phone, input.customer_email);
    if (hasWonQuoteStatus(statuses)) {
      return { outcome: 'booked', outcome_source: 'quote_tool' };
    }
  }

  if (input.ghl_contact_id) {
    try {
      const opportunities = await getOpportunitiesForContact(input.ghl_contact_id);
      const stages = stageNames ?? (await getStageNameMap());
      for (const opp of opportunities) {
        const stageName = opp.pipelineStageId ? stages.get(opp.pipelineStageId) : undefined;
        if (!stageName) continue;
        const classified = classifyStageName(stageName);
        if (classified) return { outcome: classified, outcome_source: `ghl_stage:${stageName}` };
      }
    } catch (err) {
      console.error('GHL stage outcome match failed:', err);
    }
  }

  return { outcome: 'unknown', outcome_source: null };
}
