// GET /api/verticals — list verticals with their active version and last
// update time. POST /api/verticals — create one (slug auto-derived from
// name). Both answer {configured:false} 200s when Supabase env is missing.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { slugify } from '@/lib/playbook/slug';
import type { VerticalRow } from '@/lib/playbook/types';

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, verticals: [] });
  }
  const supabase = getSupabaseServerClient()!;

  const { data: verticals, error } = await supabase
    .from('verticals')
    .select('id, slug, name, description, active_version, created_at')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('List verticals failed:', error);
    return NextResponse.json(
      { configured: true, verticals: [], error: 'Could not load verticals.' },
      { status: 500 },
    );
  }

  const rows = (verticals ?? []) as VerticalRow[];

  // "Updated" = the latest playbook version's timestamp, falling back to the
  // vertical's own created_at when it has no versions yet.
  const { data: versions } = await supabase
    .from('playbook_versions')
    .select('vertical_id, created_at')
    .order('created_at', { ascending: false });

  const latestByVertical = new Map<string, string>();
  for (const v of (versions ?? []) as { vertical_id: string; created_at: string }[]) {
    if (!latestByVertical.has(v.vertical_id)) latestByVertical.set(v.vertical_id, v.created_at);
  }

  return NextResponse.json({
    configured: true,
    verticals: rows.map(v => ({
      id: v.id,
      slug: v.slug,
      name: v.name,
      description: v.description,
      activeVersion: v.active_version,
      updatedAt: latestByVertical.get(v.id) ?? v.created_at,
    })),
  });
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const description = typeof body?.description === 'string' ? body.description.trim() : '';

  if (!name) {
    return NextResponse.json({ configured: true, error: 'name is required.' }, { status: 400 });
  }

  const supabase = getSupabaseServerClient()!;
  const { data, error } = await supabase
    .from('verticals')
    .insert({ slug: slugify(name), name, description })
    .select('id, slug, name, description, active_version, created_at')
    .single();

  if (error) {
    const isDuplicate = error.code === '23505';
    console.error('Create vertical failed:', error);
    return NextResponse.json(
      {
        configured: true,
        error: isDuplicate ? 'A vertical with that name already exists.' : 'Could not create vertical.',
      },
      { status: isDuplicate ? 409 : 500 },
    );
  }

  const vertical = data as VerticalRow;
  return NextResponse.json({
    configured: true,
    vertical: {
      id: vertical.id,
      slug: vertical.slug,
      name: vertical.name,
      description: vertical.description,
      activeVersion: vertical.active_version,
      updatedAt: vertical.created_at,
    },
  });
}
