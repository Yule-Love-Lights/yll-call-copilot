// GET /api/digest/[id] -- one digest's full content, for a direct link to a
// past week (the /digest history list links here). Same "404 when the row
// isn't found" convention as GET /api/leads/[id].
//
// Owner-facing, not rep-facing -- same reasoning as GET /api/digest (a
// specific past digest still names a rep's roughest moment verbatim).

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';
import { resolveStaffRole } from '@/lib/auth/role';
import type { DigestContent } from '@/lib/digest/runDigest';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const { id } = await params;
  const supabase = getSupabaseServerClient()!;
  const role = await resolveStaffRole(supabase, await getSessionEmail());
  if (role === 'rep') {
    return NextResponse.json({ configured: true, error: "The weekly digest is for the coach's Friday review." }, { status: 403 });
  }

  const { data, error } = await supabase.from('weekly_digests').select('id, period_start, period_end, content, created_at').eq('id', id).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migrations 0008 and 0010 first.' });
    }
    console.error('Load weekly digest failed:', error);
    return NextResponse.json({ configured: true, error: 'Could not load the digest.' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ configured: true, error: 'Digest not found.' }, { status: 404 });
  }

  const row = data as { id: string; period_start: string; period_end: string; content: DigestContent; created_at: string };
  return NextResponse.json({
    configured: true,
    digest: { id: row.id, periodStart: row.period_start, periodEnd: row.period_end, content: row.content, createdAt: row.created_at },
  });
}
