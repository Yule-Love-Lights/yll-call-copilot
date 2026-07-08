// POST /api/coaching/[id]/rate {rating: 'helpful'|'noise'} -- the rep tapped
// one of the two feedback buttons on a coaching card. A light signal for a
// later pass at tuning which triggers are worth showing; not read anywhere
// yet.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import type { RepRating } from '@/lib/live/types';

const REP_RATINGS: RepRating[] = ['helpful', 'noise'];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false, reason: 'Supabase not configured.' });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const rating = typeof body?.rating === 'string' ? body.rating : '';
  if (!(REP_RATINGS as string[]).includes(rating)) {
    return NextResponse.json({ configured: true, saved: false, error: `rating must be one of: ${REP_RATINGS.join(', ')}.` }, { status: 400 });
  }

  const supabase = getSupabaseServerClient()!;

  const { error } = await supabase.from('coaching_events').update({ rep_rating: rating }).eq('id', id);
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, saved: false, migrated: false, reason: 'Run migration 0005 first.' });
    }
    console.error('Rate coaching event failed:', error);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not save the rating.' }, { status: 500 });
  }

  return NextResponse.json({ configured: true, saved: true });
}
