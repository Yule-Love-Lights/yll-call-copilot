// POST /api/second-mile/cold-snap — the "First cold snap tonight? Queue
// check-ins." button on /second-mile. A human decides tonight is the first
// real cold snap of the season; this queues a cold_snap_checkin touch for
// every installed/won customer this season (same source as the nightly
// cron's cookies+ornament/reveal-photo steps — see
// src/lib/secondMile/installedContacts.ts). Idempotent via the yearly
// dedupe_key: clicking it twice in the same season creates zero new rows
// the second time.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { buildColdSnapCandidates } from '@/lib/secondMile/candidates';
import { getSeasonYear } from '@/lib/secondMile/decemberWindow';
import { getInstalledWonContacts } from '@/lib/secondMile/installedContacts';

export async function POST() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, created: 0 });
  }

  const supabase = getSupabaseServerClient()!;
  const now = new Date();
  const seasonYear = getSeasonYear(now);

  const { contacts, source } = await getInstalledWonContacts(supabase, seasonYear);
  const candidates = buildColdSnapCandidates(contacts, seasonYear, now);
  if (candidates.length === 0) {
    return NextResponse.json({ configured: true, created: 0, source });
  }

  const { data: inserted, error } = await supabase
    .from('second_mile_touches')
    .upsert(candidates, { onConflict: 'dedupe_key', ignoreDuplicates: true })
    .select('id');
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, created: 0, reason: 'Run migration 0013 first.' });
    }
    console.error('Queue cold-snap check-ins failed:', error);
    return NextResponse.json({ configured: true, created: 0, error: 'Could not queue check-ins.' }, { status: 500 });
  }

  return NextResponse.json({ configured: true, created: inserted?.length ?? 0, source });
}
