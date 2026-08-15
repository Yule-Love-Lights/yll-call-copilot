// GET /api/inbound/recent — inbound call/message events from the last 10
// minutes, one per contact (most recent wins), each paired with a lead:
// reuses an existing lead by ghl_contact_id, or auto-creates a source
// 'inbound' one so the dashboard can offer an actor-bound claim before the
// console opens. Polled by the dashboard every 10s while it's open (see
// src/app/InboundPop.tsx) — no live GHL calls here, everything needed was
// already captured at webhook-receipt time in events_log.detail.

import { NextResponse } from 'next/server';
import { hasCapability } from '@/lib/auth/capabilities';
import { authorizeLeadDetailRead } from '@/lib/auth/leadWork';
import { resolveCurrentHubActor } from '@/lib/auth/resource';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import {
  getContact,
  getOpportunitiesForContact,
  getStageNameMap,
  isHighLevelConfigured,
} from '@/lib/ghl/client';
import { buildInboundAutoCreateFields, isCallable } from '@/lib/leads/scoring';
import { isWithinCallingHours } from '@/lib/leads/callingHours';
import type { LeadRow } from '@/lib/leads/types';

const WINDOW_MS = 10 * 60 * 1000;

type EventDetail = { contactId?: string | null; phone?: string | null; name?: string | null };

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, events: [] });
  }

  const supabase = getSupabaseServerClient()!;
  const actorResolution = await resolveCurrentHubActor();
  if (actorResolution.status !== 'resolved') {
    return NextResponse.json(
      { configured: true, events: [], error: 'Access denied.' },
      { status: actorResolution.status === 'unavailable' ? 503 : 403 },
    );
  }
  const actor = actorResolution.actor;
  const canReadTeam = hasCapability(actor, 'operations.admin');
  const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();

  const { data: eventRows, error: eventsError } = await supabase
    .from('events_log')
    .select('id, detail, created_at')
    .eq('kind', 'inbound_call')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false });
  if (eventsError) {
    if (isMissingTableError(eventsError)) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0004 first.', events: [] });
    }
    console.error('Load recent inbound events failed:', eventsError);
    return NextResponse.json({ configured: true, error: 'Could not load recent inbound events.', events: [] }, { status: 500 });
  }

  const rows = (eventRows ?? []) as { id: number; detail: EventDetail | null; created_at: string }[];

  const seenContacts = new Set<string>();
  const results: {
    contactId: string | null;
    name: string | null;
    phone: string | null;
    leadId: string;
    pastCallsCount: number;
    openLeadReason: string | null;
    occurredAt: string;
    redacted: boolean;
    canClaim: boolean;
    canOpen: boolean;
  }[] = [];

  for (const row of rows) {
    const contactId = row.detail?.contactId ?? null;
    if (!contactId) continue; // nothing to link a lead to, nothing to pop
    if (seenContacts.has(contactId)) continue; // most-recent-per-contact only
    seenContacts.add(contactId);

    const { data: existingLeadData } = await supabase
      .from('leads')
      .select('id, reason, status, claimed_by, claimed_employee_id')
      .eq('ghl_contact_id', contactId)
      .maybeSingle();
    let lead = existingLeadData as Pick<LeadRow, 'id' | 'reason' | 'status' | 'claimed_by' | 'claimed_employee_id'> | null;

    let callable = false;
    let withinCallingHours = false;
    if (isHighLevelConfigured()) {
      try {
        const [contact, opportunities, stageNames] = await Promise.all([
          getContact(contactId),
          getOpportunitiesForContact(contactId),
          getStageNameMap(),
        ]);
        const currentStages = opportunities
          .map(opportunity => opportunity.pipelineStageId
            ? stageNames.get(opportunity.pipelineStageId)
            : null)
          .filter((stage): stage is string => !!stage);
        callable = isCallable({
          dnd: contact.dnd,
          dndSettings: contact.dndSettings,
          tags: contact.tags ?? [],
          stageNames: currentStages,
        });
        withinCallingHours = isWithinCallingHours(contact.timezone, new Date());
      } catch (err) {
        console.error(`Could not verify do-not-call status for inbound contact ${contactId}:`, err);
      }
    }

    if (!lead) {
      // Do-not-call gate: an inbound call/text from a DND/DNC-tagged contact
      // must not leave behind a standing queued row any rep can claim and
      // call back later. Best-effort GHL lookup — an unverifiable contact
      // (HighLevel not configured, or the lookup itself fails) fails closed
      // (callable stays false) rather than defaulting to callable.
      const { data: createdLeadData, error: createError } = await supabase
        .from('leads')
        .insert({
          ghl_contact_id: contactId,
          full_name: row.detail?.name ?? null,
          phone: row.detail?.phone ?? null,
          ...buildInboundAutoCreateFields(callable),
        })
        .select('id, reason, status, claimed_by, claimed_employee_id')
        .single();
      if (createError) {
        console.error('Auto-create lead for inbound call failed:', createError);
        continue; // skip this event rather than failing the whole poll
      }
      lead = createdLeadData as Pick<LeadRow, 'id' | 'reason' | 'status' | 'claimed_by' | 'claimed_employee_id'>;
    }

    const queuedPreview = lead.status === 'queued' && !canReadTeam;
    let canOpen = false;
    if (!queuedPreview) {
      const authorization = await authorizeLeadDetailRead(supabase, { actor, lead });
      if (authorization.status === 'unavailable') {
        return NextResponse.json(
          { configured: true, events: [], error: 'Could not audit this access.' },
          { status: 503 },
        );
      }
      // Another rep's claimed/done resource is not a team screen-pop for an
      // ordinary employee. Do not reveal even that it exists.
      if (authorization.status === 'denied') continue;
      canOpen = callable && withinCallingHours;
    }

    const { count } = await supabase
      .from('calls')
      .select('id', { count: 'exact', head: true })
      .eq('ghl_contact_id', contactId)
      .eq('metric_scope', 'performance');

    results.push({
      contactId: queuedPreview ? null : contactId,
      name: queuedPreview ? null : (row.detail?.name ?? null),
      // Event payload phone numbers are cached webhook data. Always reveal a
      // number only through the owned detail endpoint after its fresh GHL and
      // local-hours verification.
      phone: null,
      leadId: lead.id,
      pastCallsCount: count ?? 0,
      openLeadReason: lead.status === 'done' || lead.status === 'dismissed' ? null : lead.reason,
      occurredAt: row.created_at,
      redacted: queuedPreview,
      canClaim: lead.status === 'queued' && callable && withinCallingHours,
      canOpen,
    });
  }

  return NextResponse.json({ configured: true, events: results });
}
