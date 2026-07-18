// GET /api/brain — the "Brain" view: one unified read over knowledge the
// app already has scattered across several tables (learnings,
// playbook_proposals, documents/knowledge_notes, call_scores, transcript
// outcomes, plus brain_insights from sibling PR B), aggregated across every
// vertical into three lenses (market, leads, coaching) via
// src/lib/brain/loader.ts. Staff session only (proxy.ts already gates every
// non-public path to the staff allowlist) — no role restriction beyond
// that, since every field here is a team-wide aggregate with no per-rep
// private content (see src/lib/brain/lenses.ts's CoachingCallRow comment).

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';
import { loadBrainView } from '@/lib/brain/loader';

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const sessionEmail = await getSessionEmail();
  if (!sessionEmail) {
    return NextResponse.json({ configured: true, error: 'Not signed in.' }, { status: 401 });
  }

  const supabase = getSupabaseServerClient()!;
  const result = await loadBrainView(supabase);
  if (!result.ok) {
    return NextResponse.json({ configured: true, migrated: false, reason: result.reason });
  }

  const { market, leads, coaching, coachingReason, stats } = result.view;
  return NextResponse.json({
    configured: true,
    market,
    leads,
    coaching: coaching ?? { available: false, reason: coachingReason ?? 'Coaching data is not available yet.' },
    stats,
  });
}
