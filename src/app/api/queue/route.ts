// GET /api/queue — lists queued+claimed leads, ranked by score then age,
// with optional ?vertical= and ?minScore= filters. Also returns the last
// "Build queue" run's timestamp (from events_log) so the /queue page can
// show it next to the button.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { isWithinCallingHours } from '@/lib/leads/callingHours';
import type { LeadRow } from '@/lib/leads/types';

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, leads: [] });
  }

  const supabase = getSupabaseServerClient()!;
  const url = new URL(request.url);
  const vertical = url.searchParams.get('vertical');
  const minScoreParam = url.searchParams.get('minScore');
  const minScore = minScoreParam !== null ? Number(minScoreParam) : null;

  let query = supabase
    .from('leads')
    .select(
      'id, ghl_contact_id, full_name, phone, email, address, vertical_slug, reason, opener_hint, score, source, status, claimed_by, timezone, queued_at',
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
    leads: rows.map(r => ({
      id: r.id,
      ghlContactId: r.ghl_contact_id,
      fullName: r.full_name,
      phone: r.phone,
      email: r.email,
      address: r.address,
      verticalSlug: r.vertical_slug,
      reason: r.reason,
      openerHint: r.opener_hint,
      score: r.score,
      source: r.source,
      status: r.status,
      claimedBy: r.claimed_by,
      queuedAt: r.queued_at,
      // TCPA calling-hours gate — whether NOW falls inside 8am-9pm in this
      // contact's own local time (src/lib/leads/callingHours.ts).
      callableNow: isWithinCallingHours(r.timezone, now),
    })),
    lastBuildAt: (lastBuildData as { created_at: string } | null)?.created_at ?? null,
  });
}
