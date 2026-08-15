// GET /api/queue — lists queued+claimed leads, ranked by score then age,
// with optional ?vertical= and ?minScore= filters. Also returns the last
// "Build queue" run's timestamp (from events_log) so the /queue page can
// show it next to the button.

import { NextResponse } from 'next/server';
import { hasCapability } from '@/lib/auth/capabilities';
import { resolveCurrentHubActor } from '@/lib/auth/resource';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { isWithinCallingHours } from '@/lib/leads/callingHours';
import type { LeadRow } from '@/lib/leads/types';

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, leads: [] });
  }

  const supabase = getSupabaseServerClient()!;
  const actorResolution = await resolveCurrentHubActor();
  if (actorResolution.status !== 'resolved') {
    return NextResponse.json(
      { configured: true, error: 'Access denied.', leads: [] },
      { status: actorResolution.status === 'unavailable' ? 503 : 403 },
    );
  }
  const actor = actorResolution.actor;
  const canReadTeamQueue = hasCapability(actor, 'operations.admin');
  const canBuildQueue = hasCapability(actor, 'office.pipeline.run');
  const url = new URL(request.url);
  const vertical = url.searchParams.get('vertical');
  const minScoreParam = url.searchParams.get('minScore');
  const minScore = minScoreParam !== null ? Number(minScoreParam) : null;

  let query = supabase
    .from('leads')
    .select(
      'id, ghl_contact_id, full_name, phone, email, address, vertical_slug, reason, opener_hint, score, source, status, claimed_by, claimed_employee_id, timezone, queued_at',
    )
    .in('status', ['queued', 'claimed'])
    .order('score', { ascending: false })
    .order('queued_at', { ascending: true });

  if (vertical) query = query.eq('vertical_slug', vertical);
  if (minScore !== null && !Number.isNaN(minScore)) query = query.gte('score', minScore);

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0004 first.', leads: [] });
    }
    console.error('List queue failed:', error);
    return NextResponse.json({ configured: true, error: 'Could not load the queue.', leads: [] }, { status: 500 });
  }

  const { data: lastBuildData } = await supabase
    .from('events_log')
    .select('created_at')
    .eq('kind', 'queue_build')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const rows = (data ?? []) as Omit<LeadRow, 'done_at'>[];
  const now = new Date();
  return NextResponse.json({
    configured: true,
    canBuildQueue,
    // An ordinary Office employee may inspect customer details only after
    // winning the claim. Foreign claimed rows disappear entirely; queued rows
    // remain useful ranking previews but carry no customer identity fields.
    leads: rows
      .filter(r => canReadTeamQueue || r.status === 'queued' || (
        r.claimed_employee_id === actor.employeeId
        && r.claimed_by?.trim().toLowerCase() === actor.email
      ))
      .map(r => {
      const isMine = r.claimed_employee_id === actor.employeeId
        && r.claimed_by?.trim().toLowerCase() === actor.email;
      const redacted = !canReadTeamQueue && r.status === 'queued';
      return {
      id: r.id,
      ghlContactId: redacted ? null : r.ghl_contact_id,
      fullName: redacted ? null : r.full_name,
      // Queue rows are cached and do not rehydrate current GHL permission.
      // Never expose a phone here; the owned detail endpoint reveals it only
      // after a fresh provider and calling-hours check.
      phone: null,
      // Email is also a contact channel and this cached queue does not
      // revalidate current Email DND. Reveal it only from verified detail.
      email: null,
      address: redacted ? null : r.address,
      verticalSlug: r.vertical_slug,
      reason: r.reason,
      openerHint: r.opener_hint,
      score: r.score,
      source: r.source,
      status: r.status,
      claimedBy: canReadTeamQueue || isMine ? r.claimed_by : null,
      queuedAt: r.queued_at,
      redacted,
      isMine,
      canOpen: canReadTeamQueue || isMine,
      // TCPA calling-hours gate — whether NOW falls inside 8am-9pm in this
      // contact's own local time (src/lib/leads/callingHours.ts).
      callableNow: isWithinCallingHours(r.timezone, now),
    };
    }),
    lastBuildAt: (lastBuildData as { created_at: string } | null)?.created_at ?? null,
  });
}
