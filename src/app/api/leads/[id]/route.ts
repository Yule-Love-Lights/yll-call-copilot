// GET /api/leads/[id] — everything the call console (/call/[leadId]) needs
// in one request: the lead row, its GHL contact + current quote stage (best
// effort — a GHL hiccup degrades to nulls, it never blocks the console), the
// matched vertical's active playbook and top-3 objections, and the most
// recent call for this lead plus its follow-up drafts (so a reload after
// saving still shows them).

import { NextResponse } from 'next/server';
import { authorizeLeadDetailRead } from '@/lib/auth/leadWork';
import { resolveCurrentHubActor } from '@/lib/auth/resource';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getContact, getContactPageUrl, getOpportunitiesForContact, getStageNameMap } from '@/lib/ghl/client';
import { isWithinCallingHours } from '@/lib/leads/callingHours';
import { isCallable, isChannelAllowed } from '@/lib/leads/scoring';
import { isFollowupSendingActivated } from '@/lib/leads/followupSending';
import { computeInsights } from '@/lib/transcripts/insights';
import type { Playbook, VerticalRow } from '@/lib/playbook/types';
import type { CrmContact } from '@/lib/ghl/types';
import type { CallRow, FollowupRow, LeadRow } from '@/lib/leads/types';
import { isTwilioConfigured } from '@/lib/live/twilioVoice';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const { id } = await params;
  const supabase = getSupabaseServerClient()!;

  // Resolve the employee before the first customer-data query. The proxy's
  // route capability is necessary, but this handler still needs the concrete
  // actor to enforce ownership on service-role reads.
  const actorResolution = await resolveCurrentHubActor();
  if (actorResolution.status !== 'resolved') {
    return NextResponse.json(
      { configured: true, error: 'Access denied.' },
      { status: actorResolution.status === 'unavailable' ? 503 : 403 },
    );
  }
  const actor = actorResolution.actor;

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

  const authorization = await authorizeLeadDetailRead(supabase, { actor, lead });
  if (authorization.status !== 'authorized') {
    if (authorization.status === 'unavailable') {
      return NextResponse.json(
        { configured: true, error: 'Could not audit this access.' },
        { status: 503 },
      );
    }
    // Do not confirm the existence of another employee's customer resource.
    return NextResponse.json({ configured: true, error: 'Lead not found.' }, { status: 404 });
  }

  // GHL contact + the current open opportunity's stage name, best-effort.
  let contact: CrmContact | null = null;
  let quoteStage: string | null = null;
  let callPermissionVerified = false;
  let emailPermissionVerified = false;
  let smsPermissionVerified = false;
  let verifiedTimezone = lead.timezone;
  if (lead.ghl_contact_id) {
    try {
      contact = await getContact(lead.ghl_contact_id);
      const opportunities = await getOpportunitiesForContact(lead.ghl_contact_id);
      const stageNames = await getStageNameMap();
      const openOpp = opportunities.find(o => o.status !== 'won' && o.status !== 'lost' && o.status !== 'abandoned');
      if (openOpp?.pipelineStageId) {
        quoteStage = stageNames.get(openOpp.pipelineStageId) ?? null;
      }
      const currentStages = opportunities
        .map(opportunity => opportunity.pipelineStageId ? stageNames.get(opportunity.pipelineStageId) : null)
        .filter((stage): stage is string => !!stage);
      const permissionSnapshot = {
        dnd: contact.dnd,
        dndSettings: contact.dndSettings,
        tags: contact.tags ?? [],
        stageNames: currentStages,
      };
      callPermissionVerified = isCallable(permissionSnapshot);
      emailPermissionVerified = isChannelAllowed(permissionSnapshot, 'Email');
      smsPermissionVerified = isChannelAllowed(permissionSnapshot, 'SMS');
      verifiedTimezone = contact.timezone?.trim() || lead.timezone;
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
  const latestCallBase = supabase
    .from('calls')
    .select('id, outcome, notes, rep_email, started_at, ended_at')
    .eq('lead_id', id);
  const latestCallQuery = authorization.access === 'self'
    ? latestCallBase.eq('rep_employee_id', actor.employeeId)
    : latestCallBase;
  const { data: latestCallData } = await latestCallQuery
    .in('metric_scope', ['pending', 'performance'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const latestCall = latestCallData as Pick<CallRow, 'id' | 'outcome' | 'notes' | 'rep_email' | 'started_at' | 'ended_at'> | null;

  let followups: FollowupRow[] = [];
  if (latestCall) {
    const { data: followupData } = await supabase
      .from('followups')
      .select('*')
      .eq('call_id', latestCall.id)
      .order('created_at', { ascending: true });
    followups = (followupData ?? []) as FollowupRow[];
  }

  let liveAttempt: {
    sessionId: string;
    callId: string;
    status: 'starting' | 'active' | 'pending_outcome';
    startedAt: string;
  } | null = null;
  if (latestCall) {
    const { data: liveData } = await supabase
      .from('live_sessions')
      .select('id, call_id, status, started_at')
      .eq('call_id', latestCall.id)
      .eq('mode', 'twilio')
      .maybeSingle();
    const session = liveData as {
      id: string;
      call_id: string;
      status: 'starting' | 'active' | 'pending_outcome' | 'completed' | 'abandoned';
      started_at: string;
    } | null;

    if (session && (session.status === 'starting' || session.status === 'active' || session.status === 'pending_outcome')) {
      liveAttempt = {
        sessionId: session.id,
        callId: session.call_id,
        status: session.status,
        startedAt: session.started_at,
      };
    }
  }

  const callableNow = isWithinCallingHours(verifiedTimezone, new Date());

  return NextResponse.json({
    configured: true,
    canWork: authorization.canWork,
    canManageFollowups: authorization.canManageFollowups,
    liveCallingEnabled: isTwilioConfigured(),
    callPermissionVerified,
    liveAttempt,
    // Lets the console disable Send buttons proactively (with a tooltip)
    // instead of only discovering the gate is closed after a failed POST —
    // the env var itself is server-only and never reaches the browser.
    sendEnabled: isFollowupSendingActivated()
      && process.env.GHL_FOLLOWUP_SEND_ENABLED === 'true',
    // TCPA calling-hours gate — whether NOW falls inside 8am-9pm in this
    // contact's own local time (src/lib/leads/callingHours.ts).
    callableNow,
    lead: {
      id: lead.id,
      ghlContactId: lead.ghl_contact_id,
      fullName: lead.full_name,
      phone: callPermissionVerified && callableNow ? lead.phone : null,
      email: emailPermissionVerified ? lead.email : null,
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
    contact: contact
      ? {
          ...contact,
          phone: callPermissionVerified && callableNow ? contact.phone : undefined,
          email: emailPermissionVerified ? contact.email : undefined,
        }
      : null,
    contactUrl: lead.ghl_contact_id && (
      authorization.access === 'team' || (callPermissionVerified && callableNow)
    ) ? getContactPageUrl(lead.ghl_contact_id) : null,
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
      // SMS recipients are phone numbers. Apply the same current permission
      // and quiet-hours redaction as the contact card so an old draft cannot
      // become a back door to copy a number that is no longer callable.
      toAddress: (
        (f.kind === 'sms' && (!smsPermissionVerified || !callableNow))
        || (f.kind === 'email' && !emailPermissionVerified)
      ) ? '' : f.to_address,
      subject: f.subject,
      body: f.body,
      status: f.status,
      createdAt: f.created_at,
      sentAt: f.sent_at,
    })),
  });
}
