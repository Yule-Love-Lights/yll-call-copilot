// Shared "store an inbound email, then best-effort draft it" step used by
// both POST /api/webhooks/ghl (path A, live) and POST /api/inbox/check
// (path B, fallback GHL poll + future Gmail adapter). Idempotent on
// source_message_id: a webhook retry or a check-run re-seeing the same
// message must never insert a second inbound_emails row or draft it twice.
// Mirrors the vertical -> active playbook two-step already used by
// POST /api/calls and GET /api/leads/[id] (src/app/api/calls/route.ts),
// factored out here rather than duplicated a third time.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '../supabase';
import type { Playbook, VerticalRow } from '../playbook/types';
import { DEFAULT_GUARANTEES, detectVerticalSlug, generateEmailReply, type GuaranteeOption } from './draft';
import type { EmailSource, InboundEmailRow } from './types';

async function loadPlaybookForVertical(
  supabase: SupabaseClient,
  slug: string,
): Promise<{ verticalName: string | null; playbook: Playbook | null }> {
  const { data: verticalData } = await supabase
    .from('verticals')
    .select('id, name, active_version')
    .eq('slug', slug)
    .maybeSingle();
  if (!verticalData) return { verticalName: null, playbook: null };
  const v = verticalData as Pick<VerticalRow, 'id' | 'name' | 'active_version'>;
  if (v.active_version <= 0) return { verticalName: v.name, playbook: null };

  const { data: versionData } = await supabase
    .from('playbook_versions')
    .select('content')
    .eq('vertical_id', v.id)
    .eq('version', v.active_version)
    .maybeSingle();
  return { verticalName: v.name, playbook: (versionData as { content: Playbook } | null)?.content ?? null };
}

type OfferElement = {
  key?: unknown;
  customer_line?: unknown;
  applies_to?: unknown;
  active?: unknown;
};

// applies_to is authored as either an array ('["holiday","permanent"]'), a
// single slug, or a comma-list string ("holiday,permanent") -- and 'all' (or
// 'all' as one entry of a comma-list) is the wildcard meaning every vertical,
// not a literal slug to match against verticalSlug. Exported for direct unit
// coverage (see ingest.test.ts) rather than only exercised indirectly through
// loadGuarantees/ingestInboundEmail.
export function appliesToVertical(applies_to: unknown, verticalSlug: string): boolean {
  if (applies_to == null) return true;
  const rawList = Array.isArray(applies_to) ? applies_to : [applies_to];
  const list = rawList
    .flatMap(item => (typeof item === 'string' ? item.split(',') : [item]))
    .map(item => (typeof item === 'string' ? item.trim() : item))
    .filter(item => item !== '');
  if (list.length === 0) return true;
  if (list.includes('all')) return true;
  return list.includes(verticalSlug);
}

// Reads the latest offer_versions row (ships in sibling migration 0014) for
// the guarantee lines to weave into a reply. Degrades to DEFAULT_GUARANTEES
// on a missing table, an empty/malformed row, an unreachable table, or any
// other error -- this must never block drafting. Exported for direct unit
// coverage (see ingest.test.ts).
export async function loadGuarantees(supabase: SupabaseClient, verticalSlug: string): Promise<GuaranteeOption[]> {
  try {
    const { data, error } = await supabase
      .from('offer_versions')
      .select('content')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      if (!isMissingTableError(error)) console.error('Load offer_versions for email draft failed:', error);
      return DEFAULT_GUARANTEES;
    }

    const elements = (data as { content?: { elements?: unknown } } | null)?.content?.elements;
    if (!Array.isArray(elements) || elements.length === 0) return DEFAULT_GUARANTEES;

    const options: GuaranteeOption[] = (elements as OfferElement[])
      .filter(el => el.active !== false)
      .filter(el => appliesToVertical(el.applies_to, verticalSlug))
      .filter((el): el is OfferElement & { key: string; customer_line: string } => typeof el.key === 'string' && typeof el.customer_line === 'string' && el.customer_line.trim().length > 0)
      .map(el => ({ key: el.key, text: el.customer_line }));

    return options.length > 0 ? options : DEFAULT_GUARANTEES;
  } catch (err) {
    console.error('Load offer_versions for email draft failed:', err);
    return DEFAULT_GUARANTEES;
  }
}

export type DraftResult = { ok: true } | { ok: false; error: string };

// Drafts a reply for an already-stored inbound email and writes both the
// email_reply_drafts row and the inbound_emails status flip. Shared by
// ingestInboundEmail below (fresh ingest) and POST /api/inbox/[id]/redraft
// (a rep-triggered regenerate) and the retry sweep in POST /api/inbox/check
// (anything left at 'new' by a prior failed attempt here).
//
// Claims the row (status 'new' -> 'drafted') BEFORE the slow Claude call
// (5-20s) so two callers racing the same row -- the check retry sweep vs the
// webhook's own draft, or two overlapping /api/inbox/check clicks -- can't
// both draft (and bill) the same email. Same conditional-update-before-slow-
// work pattern as POST /api/inbox/[draftId]/send's claim-before-send. A
// caller that redrafts an already-'drafted'/'sent' row (the redraft route)
// must reset it to 'new' first so this claim can succeed.
export async function draftForInboundEmail(
  supabase: SupabaseClient,
  inboundEmail: Pick<InboundEmailRow, 'id' | 'subject' | 'body' | 'from_name'>,
): Promise<DraftResult> {
  const { data: claimedRows, error: claimError } = await supabase
    .from('inbound_emails')
    .update({ status: 'drafted' })
    .eq('id', inboundEmail.id)
    .eq('status', 'new')
    .select('id');
  if (claimError) {
    console.error('Claim inbound email for drafting failed:', claimError);
    return { ok: false, error: 'Could not claim the email for drafting.' };
  }
  if (!claimedRows || claimedRows.length === 0) {
    // Someone else already owns this row (another in-flight draft, or it was
    // already sent/dismissed) -- not an error, just a no-op so this caller
    // doesn't double-draft.
    return { ok: false, error: 'Already claimed by another drafting attempt.' };
  }

  try {
    const verticalSlug = detectVerticalSlug(inboundEmail.subject, inboundEmail.body);
    const { verticalName, playbook } = await loadPlaybookForVertical(supabase, verticalSlug);
    const guarantees = await loadGuarantees(supabase, verticalSlug);

    const draft = await generateEmailReply({
      fromName: inboundEmail.from_name,
      subject: inboundEmail.subject,
      body: inboundEmail.body,
      verticalName,
      playbook,
      guarantees,
    });

    const { error: draftError } = await supabase.from('email_reply_drafts').insert({
      inbound_email_id: inboundEmail.id,
      subject: draft.subject,
      body: draft.body,
      intent: draft.intent,
      guarantee_used: draft.guarantee_used,
    });
    if (draftError) throw draftError;

    const { error: statusError } = await supabase
      .from('inbound_emails')
      .update({ intent: draft.intent, status: 'drafted' })
      .eq('id', inboundEmail.id);
    if (statusError) throw statusError;

    return { ok: true };
  } catch (err) {
    // Release the claim: this row was just flipped to 'drafted' above, but
    // no draft row exists (Claude/validation failed, or the insert/status
    // write did) -- revert to 'new' so POST /api/inbox/check's retry sweep
    // and a rep's manual "Redraft" button can both pick it up later. Never
    // throw out of here -- the caller (an ingest, a redraft click, or the
    // retry sweep) must keep going.
    const { error: revertError } = await supabase.from('inbound_emails').update({ status: 'new' }).eq('id', inboundEmail.id);
    if (revertError) console.error('Revert inbound email to new after failed draft failed:', revertError);
    console.error('Draft inbound email reply failed (left as new for retry):', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not draft a reply.' };
  }
}

export type IngestInboundEmailInput = {
  source: EmailSource;
  sourceMessageId: string | null;
  ghlContactId?: string | null;
  ghlConversationId?: string | null;
  fromAddress: string | null;
  fromName: string | null;
  subject: string | null;
  body: string;
  receivedAt: string | null;
};

export type IngestInboundEmailResult =
  | { ok: true; inserted: true; inboundEmailId: string; drafted: boolean }
  | { ok: true; inserted: false; reason: string }
  | { ok: false; error: string; missingTable?: boolean };

const UNIQUE_VIOLATION = '23505';

export async function ingestInboundEmail(
  supabase: SupabaseClient,
  input: IngestInboundEmailInput,
): Promise<IngestInboundEmailResult> {
  if (input.sourceMessageId) {
    const { data: existing, error: existingError } = await supabase
      .from('inbound_emails')
      .select('id')
      .eq('source_message_id', input.sourceMessageId)
      .maybeSingle();
    if (existingError) {
      if (isMissingTableError(existingError)) return { ok: false, error: 'Run migration 0012 first.', missingTable: true };
      return { ok: false, error: 'Could not check for a duplicate inbound email.' };
    }
    if (existing) return { ok: true, inserted: false, reason: 'Already ingested (duplicate source_message_id).' };
  }

  const { data: insertedData, error: insertError } = await supabase
    .from('inbound_emails')
    .insert({
      source: input.source,
      source_message_id: input.sourceMessageId,
      ghl_contact_id: input.ghlContactId ?? null,
      ghl_conversation_id: input.ghlConversationId ?? null,
      from_address: input.fromAddress,
      from_name: input.fromName,
      subject: input.subject,
      body: input.body,
      received_at: input.receivedAt,
    })
    .select('id')
    .single();
  if (insertError) {
    if ((insertError as { code?: string }).code === UNIQUE_VIOLATION) {
      return { ok: true, inserted: false, reason: 'Already ingested (duplicate source_message_id).' };
    }
    if (isMissingTableError(insertError)) return { ok: false, error: 'Run migration 0012 first.', missingTable: true };
    console.error('Insert inbound email failed:', insertError);
    return { ok: false, error: 'Could not store the inbound email.' };
  }
  const inboundEmailId = (insertedData as { id: string }).id;

  const draftResult = await draftForInboundEmail(supabase, {
    id: inboundEmailId,
    subject: input.subject,
    body: input.body,
    from_name: input.fromName,
  });

  return { ok: true, inserted: true, inboundEmailId, drafted: draftResult.ok };
}
