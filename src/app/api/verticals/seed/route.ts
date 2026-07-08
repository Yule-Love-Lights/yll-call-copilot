// POST /api/verticals/seed — inserts the 4 YLL default verticals when the
// table is empty. Idempotent: a second call sees a non-empty table and no-ops
// (see shouldSeedDefaults in src/lib/playbook/seed.ts for the testable gate).

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { DEFAULT_VERTICALS, shouldSeedDefaults } from '@/lib/playbook/seed';

export async function POST() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, seeded: false, reason: 'Supabase not configured.' });
  }

  const supabase = getSupabaseServerClient()!;
  const { count, error: countError } = await supabase
    .from('verticals')
    .select('id', { count: 'exact', head: true });

  if (countError) {
    console.error('Seed count check failed:', countError);
    return NextResponse.json(
      { configured: true, seeded: false, reason: 'Could not check existing verticals.' },
      { status: 500 },
    );
  }

  if (!shouldSeedDefaults(count ?? 0)) {
    return NextResponse.json({ configured: true, seeded: false, reason: 'Verticals already exist.' });
  }

  const { error: insertError } = await supabase.from('verticals').insert(DEFAULT_VERTICALS);

  if (insertError) {
    console.error('Seed insert failed:', insertError);
    return NextResponse.json(
      { configured: true, seeded: false, reason: 'Could not insert default verticals.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ configured: true, seeded: true, count: DEFAULT_VERTICALS.length });
}
