// GET /api/inbound/recent — inbound call/message events from the last 10
// minutes, one per contact (most recent wins), each paired with a lead:
// reuses an existing lead by ghl_contact_id, or auto-creates a source
// 'inbound' one so the dashboard's "Open console" always has somewhere to
// go. Polled by the dashboard every 10s while it's open (see
// src/app/InboundPop.tsx) — no live GHL calls here, everything needed was
// already captured at webhook-receipt time in events_log.detail.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import type { LeadRow } from '@/lib/leads/types';

const WINDOW_MS = 10 * 60 * 1000;

type EventDetail = { contactId?: string | null; phone?: string | null; name?: string | null };

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, events: [] });
  }

  const supabase = getSupabaseServerClient()!;
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
  }[] = [];

  for (const row of rows) {
    const contactId = row.detail?.contactId ?? null;
    if (!contactId) continue; // nothing to link a lead to, nothing to pop
    if (seenContacts.has(contactId)) continue; // most-recent-per-contact only
    seenContacts.add(contactId);

    const { data: existingLeadData } = await supabase
      .from('leads')
      .select('id, reason, status')
      .eq('ghl_contact_id', contactId)
      .maybeSingle();
    let lead = existingLeadData as Pick<LeadRow, 'id' | 'reason' | 'status'> | null;

    if (!lead) {
      const { data: createdLeadData, error: createError } = await supabase
        .from('leads')
        .insert({
          ghl_contact_id: contactId,
          full_name: row.detail?.name ?? null,
          phone: row.detail?.phone ?? null,
          reason: 'Inbound call just now',
          opener_hint: 'Inbound follow-up',
          score: 100,
          source: 'inbound',
        })
        .select('id, reason, status')
        .single();
      if (createError) {
        console.error('Auto-create lead for inbound call failed:', createError);
        continue; // skip this event rather than failing the whole poll
      }
      lead = createdLeadData as Pick<LeadRow, 'id' | 'reason' | 'status'>;
    }

    const { count } = await supabase
      .from('calls')
      .select('id', { count: 'exact', head: true })
      .eq('ghl_contact_id', contactId);

    results.push({
      contactId,
      name: row.detail?.name ?? null,
      phone: row.detail?.phone ?? null,
      leadId: lead.id,
      pastCallsCount: count ?? 0,
      openLeadReason: lead.status === 'done' || lead.status === 'dismissed' ? null : lead.reason,
      occurredAt: row.created_at,
    });
  }

  return NextResponse.json({ configured: true, events: results });
}
