// GET /api/offer: the active offer content (highest version), plus the
// version history. Open to all signed-in staff (gated by the app's normal
// proxy auth like every other route here). POST /api/offer: validates a
// full OfferContent and stores it as the next version (source: 'edited'),
// mirroring PUT /api/verticals/[id]/playbook -- restricted to non-rep roles
// (owner/admin), same as the sibling settings routes: these are the exact
// guarantee lines reps say to customers and the scorer grades against, not
// something any rep should be able to silently rewrite.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';
import { resolveStaffRole } from '@/lib/auth/role';
import { DEFAULT_OFFER_CONTENT, saveOfferEdit, validateOfferContent } from '@/lib/offer/store';
import type { OfferVersionRow } from '@/lib/offer/store';

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, content: DEFAULT_OFFER_CONTENT, version: null, source: null, history: [] });
  }

  const supabase = getSupabaseServerClient()!;
  const { data, error } = await supabase
    .from('offer_versions')
    .select('version, content, source, created_at')
    .order('version', { ascending: false });

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({
        configured: true,
        migrated: false,
        reason: 'Run migration 0014 first.',
        content: DEFAULT_OFFER_CONTENT,
        version: null,
        source: null,
        history: [],
      });
    }
    console.error('Load offer failed:', error);
    return NextResponse.json({ configured: true, error: 'Could not load the offer.' }, { status: 500 });
  }

  const rows = (data ?? []) as Pick<OfferVersionRow, 'version' | 'content' | 'source' | 'created_at'>[];
  if (rows.length === 0) {
    return NextResponse.json({ configured: true, content: DEFAULT_OFFER_CONTENT, version: null, source: null, history: [] });
  }

  const active = rows[0];
  return NextResponse.json({
    configured: true,
    content: active.content,
    version: active.version,
    source: active.source,
    history: rows.map(r => ({ version: r.version, source: r.source, createdAt: r.created_at })),
  });
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false, reason: 'Supabase not configured.' });
  }

  const supabase = getSupabaseServerClient()!;
  const role = await resolveStaffRole(supabase, await getSessionEmail());
  if (role === 'rep') {
    return NextResponse.json(
      { configured: true, saved: false, reason: 'Offer editing is for the coach.' },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const validated = validateOfferContent(body);
  if (!validated.valid) {
    return NextResponse.json({ configured: true, saved: false, reason: validated.error }, { status: 400 });
  }

  const result = await saveOfferEdit(supabase, validated.content);
  if (!result.ok) {
    return NextResponse.json({ configured: true, saved: false, reason: result.reason }, { status: result.status });
  }

  return NextResponse.json({ configured: true, saved: true, version: result.version });
}
