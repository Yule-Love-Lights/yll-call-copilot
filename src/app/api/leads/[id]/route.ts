// GET /api/leads/[id] — everything the call console (/call/[leadId]) needs
// in one request: the lead row, its GHL contact + current quote stage (best
// effort — a GHL hiccup degrades to nulls, it never blocks the console), the
// matched vertical's active playbook and top-3 objections, and the most
// recent call for this lead plus its follow-up drafts (so a reload after
// saving still shows them).

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getContact, getContactPageUrl, getOpportunitiesForContact, getStageNameMap, isHighLevelConfigured } from '@/lib/ghl/client';
import { computeInsights } from '@/lib/transcripts/insights';
import type { Playbook, VerticalRow } from '@/lib/playbook/types';
import type { CrmContact } from '@/lib/ghl/types';
import type { CallRow, FollowupRow, LeadRow } from '@/lib/leads/types';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const { id } = await params;
  const supabase = getSupabaseServerClient()!;

  const { data: leadData, error: leadError } = await supabase.from('leads').select('*').eq('id', id).maybeSingle();
  if (leadError) {
    if (isMissingTableError(leadError)) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0004 first.' });
    }
    console.error('Load lead failed:', leadError);
    return NextResponse.json({ configured: true, error: 'Could not load lead.' }, { status: 500 });
  }
  if (!leadData) {
    return NextResponse.json({ configured: true, error: 'Lead not found.' }, { status: 404 });
  }
  const lead = leadData as LeadRow;

  // GHL contact + the current open opportunity's stage name, best-effort.
  let contact: CrmContact | null = null;
  let quoteStage: string | null = null;
  if (lead.ghl_contact_id && isHighLevelConfigured()) {
    try {
      contact = await getContact(lead.ghl_contact_id);
      const opportunities = await getOpportunitiesForContact(lead.ghl_contact_id);
      const openOpp = opportunities.find(o => o.status !== 'won' && o.status !== 'lost' && o.status !== 'abandoned');
      if (openOpp?.pipelineStageId) {
        const stageNames = await getStageNameMap();
        quoteStage = stageNames.get(openOpp.pipelineStageId) ?? null;
      }
    } catch (err) {
      console.error('Could not hydrate GHL contact for the call console:', err);
    }
  }

  // Matched vertical -> active playbook + top-3 objections, best-effort.
  let vertical: { id: string; slug: string; name: string } | null = null;
  let playbook: Playbook | null = null;
  let topObjections: { objection: string; count: number; pct: number }[] = [];
  if (lead.vertical_slug) {
    const { data: verticalData } = await supabase
      .from('verticals')
      .select('id, slug, name, active_version')
      .eq('slug', lead.vertical_slug)
      .maybeSingle();
    if (verticalData) {
      const v = verticalData as Pick<VerticalRow, 'id' | 'slug' | 'name' | 'active_version'>;
      vertical = { id: v.id, slug: v.slug, name: v.name };

      if (v.active_version > 0) {
        const { data: versionData } = await supabase
          .from('playbook_versions')
          .select('content')
          .eq('vertical_id', v.id)
          .eq('version', v.active_version)
          .maybeSingle();
        playbook = (versionData as { content: Playbook } | null)?.content ?? null;
      }

      const insightsResult = await computeInsights(supabase, v.id);
      if (insightsResult.ok) topObjections = insightsResult.aggregate.topObjections.slice(0, 3);
    }
  }

  // Most recent call for this lead + its follow-up drafts, if any.
  const { data: latestCallData } = await supabase
    .from('calls')
    .select('id, outcome, notes, started_at, ended_at')
    .eq('lead_id', id)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const latestCall = latestCallData as Pick<CallRow, 'id' | 'outcome' | 'notes' | 'started_at' | 'ended_at'> | null;

  let followups: FollowupRow[] = [];
  if (latestCall) {
    const { data: followupData } = await supabase
      .from('followups')
      .select('*')
      .eq('call_id', latestCall.id)
      .order('created_at', { ascending: true });
    followups = (followupData ?? []) as FollowupRow[];
  }

  return NextResponse.json({
    configured: true,
    // Lets the console disable Send buttons proactively (with a tooltip)
    // instead of only discovering the gate is closed after a failed POST —
    // the env var itself is server-only and never reaches the browser.
    sendEnabled: process.env.GHL_SEND_ENABLED === 'true',
    lead: {
      id: lead.id,
      ghlContactId: lead.ghl_contact_id,
      fullName: lead.full_name,
      phone: lead.phone,
      email: lead.email,
      address: lead.address,
      verticalSlug: lead.vertical_slug,
      reason: lead.reason,
      openerHint: lead.opener_hint,
      score: lead.score,
      source: lead.source,
      status: lead.status,
      claimedBy: lead.claimed_by,
      queuedAt: lead.queued_at,
    },
    contact,
    contactUrl: lead.ghl_contact_id ? getContactPageUrl(lead.ghl_contact_id) : null,
    quoteStage,
    vertical,
    playbook,
    topObjections,
    latestCall: latestCall
      ? {
          id: latestCall.id,
          outcome: latestCall.outcome,
          notes: latestCall.notes,
          startedAt: latestCall.started_at,
          endedAt: latestCall.ended_at,
        }
      : null,
    followups: followups.map(f => ({
      id: f.id,
      kind: f.kind,
      toAddress: f.to_address,
      subject: f.subject,
      body: f.body,
      status: f.status,
      createdAt: f.created_at,
      sentAt: f.sent_at,
    })),
  });
}
