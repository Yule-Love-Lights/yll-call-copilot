// DELETE /api/brain/insights/[id] -- removes one brain insight, same
// pattern as DELETE /api/documents/[id].

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, deleted: false, reason: 'Supabase not configured.' });
  }

  const { id } = await params;
  const supabase = getSupabaseServerClient()!;

  const { error } = await supabase.from('brain_insights').delete().eq('id', id);
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, deleted: false, reason: 'Run migration 0015 first.' });
    }
    console.error('Delete brain insight failed:', error);
    return NextResponse.json({ configured: true, deleted: false, reason: 'Could not delete the insight.' }, { status: 500 });
  }

  return NextResponse.json({ configured: true, deleted: true });
}
