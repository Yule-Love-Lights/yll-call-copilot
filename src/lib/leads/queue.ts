// Orchestrates the "Build queue" button (POST /api/queue/build): pulls three
// signals from GoHighLevel (recent contacts, open opportunities, and the
// pipeline stage name map), turns them into scored lead candidates via the
// pure builders in ./scoring, then upserts them into the `leads` table.
// Sequential GHL calls with a gap between them, same convention as the
// Phase 1.5 transcript ingest pipeline (src/lib/transcripts/ingest.ts) — this
// reuses its delay()/GHL_RATE_LIMIT_GAP_MS rather than duplicating them.
//
// No cron here — this only runs when a human clicks "Build queue."

import { getSupabaseServerClient, isSupabaseConfigured } from '../supabase';
import {
  getContact,
  getOpenOpportunities,
  getStageNameMap,
  isHighLevelConfigured,
  listContacts,
} from '../ghl/client';
import type { HighLevelOpportunity } from '../ghl/types';
import { delay, GHL_RATE_LIMIT_GAP_MS } from '../transcripts/ingest';
import {
  buildInboundCandidate,
  buildQuoteFollowupCandidate,
  buildSeasonPlayCandidate,
  decideUpsert,
  isCallable,
  isQuoteSentStage,
  olderThanDays,
  seasonPlay,
  type LeadCandidate,
  type MinimalContact,
} from './scoring';
import type { LeadStatus } from './types';

// Applied per source (inbound / quote follow-up / season play), not to the
// total — a build can produce up to 300 candidates before dedupe.
export const MAX_LEADS_PER_SOURCE = 100;

export type BuildQueueResult = { added: number; refreshed: number };

async function collectCandidates(now: Date): Promise<LeadCandidate[]> {
  const stageNames = await getStageNameMap();
  await delay(GHL_RATE_LIMIT_GAP_MS);
  const openOpportunities = await getOpenOpportunities();
  await delay(GHL_RATE_LIMIT_GAP_MS);
  const contacts = await listContacts();

  const opportunitiesByContact = new Map<string, HighLevelOpportunity[]>();
  for (const opp of openOpportunities) {
    const list = opportunitiesByContact.get(opp.contactId);
    if (list) list.push(opp);
    else opportunitiesByContact.set(opp.contactId, [opp]);
  }
  const stageNamesFor = (contactId: string): string[] =>
    (opportunitiesByContact.get(contactId) ?? [])
      .map(o => (o.pipelineStageId ? stageNames.get(o.pipelineStageId) : undefined))
      .filter((s): s is string => !!s);

  const candidates: LeadCandidate[] = [];

  // Source 1: inbound speed-to-lead. Tags are free (already on the contact);
  // the stage name only needs a local map lookup since open opportunities
  // were already fetched once above — no per-contact GHL call.
  let inboundCount = 0;
  for (const c of contacts) {
    if (inboundCount >= MAX_LEADS_PER_SOURCE) break;
    // Do-not-call gate first: dnd flag, DNC-ish tags, or a DNC-ish stage
    // (live pipelines include "DO NOT CALL", "Spam Calls", "Pause
    // Communications Until October") keep a contact out of the queue.
    if (!isCallable({ dnd: c.dnd, tags: c.tags ?? [], stageNames: stageNamesFor(c.id) })) continue;
    const candidate = buildInboundCandidate({ contact: c, stageName: stageNamesFor(c.id)[0] ?? null, now });
    if (candidate) {
      candidates.push(candidate);
      inboundCount++;
    }
  }

  // Source 2: quote follow-ups. An opportunity's embedded `contact` ref
  // covers the common case with no extra call; only fall back to
  // getContact() (sequential, gapped) when GHL didn't embed one.
  let quoteCount = 0;
  for (const opp of openOpportunities) {
    if (quoteCount >= MAX_LEADS_PER_SOURCE) break;
    const stageName = opp.pipelineStageId ? (stageNames.get(opp.pipelineStageId) ?? null) : null;
    if (opp.status === 'won' || opp.status === 'lost') continue;
    if (!isQuoteSentStage(stageName)) continue;
    if (!olderThanDays(opp.updatedAt ?? opp.createdAt, 3, now)) continue;

    let contactRef: MinimalContact | null = opp.contact
      ? { id: opp.contact.id, name: opp.contact.name, email: opp.contact.email, phone: opp.contact.phone }
      : null;
    if (!contactRef) {
      try {
        const hydrated = await getContact(opp.contactId);
        contactRef = { id: hydrated.id, name: hydrated.fullName ?? null, email: hydrated.email ?? null, phone: hydrated.phone ?? null };
      } catch (err) {
        console.error(`Could not hydrate contact ${opp.contactId} for a quote follow-up candidate:`, err);
      }
      await delay(GHL_RATE_LIMIT_GAP_MS);
    }
    if (!contactRef) continue;

    // The embedded contact ref carries no tags/dnd, so this gate can only
    // see the contact's opportunity stage names — a dnd-flagged contact
    // slips this source until hydration adds the flag. Documented gap.
    if (!isCallable({ dnd: undefined, tags: [], stageNames: stageNamesFor(opp.contactId) })) continue;

    const candidate = buildQuoteFollowupCandidate({ opportunity: opp, stageName, contact: contactRef, now });
    if (candidate) {
      candidates.push(candidate);
      quoteCount++;
    }
  }

  // Source 3: season play. Same contact page as source 1, filtered by tag
  // instead of recency — a past customer who hasn't touched GHL recently
  // falls outside this page, a known limitation of scoring off one page
  // (see the comment on listContacts()).
  const play = seasonPlay(now);
  let seasonCount = 0;
  for (const c of contacts) {
    if (seasonCount >= MAX_LEADS_PER_SOURCE) break;
    if (!isCallable({ dnd: c.dnd, tags: c.tags ?? [], stageNames: stageNamesFor(c.id) })) continue;
    const candidate = buildSeasonPlayCandidate({ contact: c, openStageNames: stageNamesFor(c.id), play });
    if (candidate) {
      candidates.push(candidate);
      seasonCount++;
    }
  }

  return candidates;
}

export async function buildQueue(): Promise<BuildQueueResult> {
  if (!isSupabaseConfigured() || !isHighLevelConfigured()) return { added: 0, refreshed: 0 };
  const supabase = getSupabaseServerClient()!;
  const now = new Date();

  const candidates = await collectCandidates(now);

  // Dedupe by contact — a person could plausibly match more than one source
  // in the same build (e.g. a past customer who also just requested a new
  // quote). Sources were processed inbound → quote → season above, so
  // first-seen-wins keeps the highest-scoring candidate for that contact.
  const byContact = new Map<string, LeadCandidate>();
  for (const c of candidates) {
    if (!byContact.has(c.ghl_contact_id)) byContact.set(c.ghl_contact_id, c);
  }
  const deduped = [...byContact.values()];

  let added = 0;
  let refreshed = 0;

  if (deduped.length > 0) {
    // One batched lookup for every candidate's existing row, instead of one
    // select per candidate — this app's own database has no rate limit to
    // worry about, but there is no reason to make 100+ round trips either.
    const { data: existingRows, error: selectError } = await supabase
      .from('leads')
      .select('id, ghl_contact_id, status')
      .in(
        'ghl_contact_id',
        deduped.map(c => c.ghl_contact_id),
      );
    // Thrown, not swallowed: a missing `leads` table means migration 0004
    // hasn't been applied, and the calling route translates this into the
    // {configured:true, migrated:false} response via isMissingTableError.
    if (selectError) throw selectError;

    const existingByContact = new Map(
      (existingRows ?? []).map(r => [r.ghl_contact_id as string, { id: r.id as string, status: r.status as LeadStatus }]),
    );

    for (const candidate of deduped) {
      const decision = decideUpsert(existingByContact.get(candidate.ghl_contact_id) ?? null);
      if (decision.action === 'skip') continue;

      const fields = {
        full_name: candidate.full_name,
        phone: candidate.phone,
        email: candidate.email,
        address: candidate.address,
        vertical_slug: candidate.vertical_slug,
        reason: candidate.reason,
        opener_hint: candidate.opener_hint,
        score: candidate.score,
        source: candidate.source,
      };

      if (decision.action === 'insert') {
        const { error } = await supabase.from('leads').insert({ ghl_contact_id: candidate.ghl_contact_id, ...fields });
        if (error) throw error;
        added++;
      } else {
        const { error } = await supabase.from('leads').update(fields).eq('id', decision.leadId);
        if (error) throw error;
        refreshed++;
      }
    }
  }

  const { error: logError } = await supabase
    .from('events_log')
    .insert({ kind: 'queue_build', detail: { added, refreshed, scanned: candidates.length } });
  // Best-effort: the lead rows above already landed, so a logging failure
  // shouldn't make the caller think the whole build failed.
  if (logError) console.error('Log queue_build event failed:', logError);

  return { added, refreshed };
}
