// Cross-references a parsed transcript against GoHighLevel to label its
// outcome: search by phone first, then by name; inspect the matched
// contact's opportunities and classify by pipeline STAGE NAME keywords
// (this app has no HIGHLEVEL_STAGE_* env vars pinning exact stage ids, so it
// matches on name text instead — see src/lib/ghl/client.ts). The matcher is
// optional at ingest time (a checkbox, default on) and best-effort: any GHL
// failure degrades to 'unknown' rather than failing the whole ingest run.

import { getOpportunitiesForContact, getStageNameMap, searchContacts } from '../ghl/client';
import type { TranscriptOutcome } from './types';

export type OutcomeMatch = {
  outcome: TranscriptOutcome;
  outcome_source: string | null;
  ghl_contact_id: string | null;
};

export type MatchableTranscript = {
  customer_phone?: string | null;
  customer_name?: string | null;
};

// Vocabulary verified against the LIVE GHL pipelines on 2026-07-08 (stage
// names like "⏰Approved", "⭐Installed", "💼Job in Jobber", "Job Completed",
// "⛔Out of Budget", "Declined for 2025", "No Response/Abandoned"). The bare
// 'not' keyword was dropped: as a substring it also matched unrelated words.
const BOOKED_KEYWORDS = ['signed', 'won', 'booked', 'approved', 'installed', 'completed', 'closed', 'job in jobber'];
const NOT_BOOKED_KEYWORDS = [
  'lost',
  'dead',
  'declined',
  'abandoned',
  'out of budget',
  'spam',
  'no response',
  'do not call',
  'not booked',
  'not interested',
];

// Exported for the unit tests — a stage name maps to at most one outcome;
// 'booked' keywords are checked first so a name like "Not Booked - Lost"
// still resolves (an edge case the "not" keyword alone could otherwise
// mis-order against a name that also happens to contain "booked").
export function classifyStageName(name: string): TranscriptOutcome | null {
  const n = name.toLowerCase();
  if (BOOKED_KEYWORDS.some(k => n.includes(k))) return 'booked';
  if (NOT_BOOKED_KEYWORDS.some(k => n.includes(k))) return 'not_booked';
  return null;
}

// `stageNames` is optional so a standalone call still works (it fetches its
// own map), but the ingest routes fetch the pipeline list ONCE per batch and
// pass it through here — a run of thousands of transcripts must not refetch
// GHL's pipeline list once per row.
export async function matchOutcome(
  t: MatchableTranscript,
  stageNames?: Map<string, string>,
): Promise<OutcomeMatch> {
  try {
    let contact = null;

    if (t.customer_phone) {
      const results = await searchContacts(t.customer_phone);
      contact = results[0] ?? null;
    }
    if (!contact && t.customer_name) {
      const results = await searchContacts(t.customer_name);
      contact = results[0] ?? null;
    }
    if (!contact) {
      return { outcome: 'unknown', outcome_source: null, ghl_contact_id: null };
    }

    const opportunities = await getOpportunitiesForContact(contact.id);
    if (opportunities.length === 0) {
      return { outcome: 'unknown', outcome_source: 'no_opportunity', ghl_contact_id: contact.id };
    }

    const stages = stageNames ?? (await getStageNameMap());

    for (const opp of opportunities) {
      const stageName = opp.pipelineStageId ? stages.get(opp.pipelineStageId) : undefined;
      if (!stageName) continue;
      const classified = classifyStageName(stageName);
      if (classified) {
        return { outcome: classified, outcome_source: `stage:${stageName}`, ghl_contact_id: contact.id };
      }
    }

    return { outcome: 'unknown', outcome_source: 'no_clear_stage', ghl_contact_id: contact.id };
  } catch (err) {
    console.error('Outcome match failed:', err);
    return { outcome: 'unknown', outcome_source: 'ghl_error', ghl_contact_id: null };
  }
}
