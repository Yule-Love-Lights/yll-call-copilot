// DELETE /api/documents/[id] — removes one knowledge document.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, deleted: false, reason: 'Supabase not configured.' });
  }

  const { id } = await params;
  const supabase = getSupabaseServerClient()!;

  const { error } = await supabase.from('documents').delete().eq('id', id);
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, deleted: false, reason: 'Run migration 0003 first.' });
    }
    console.error('Delete document failed:', error);
    return NextResponse.json({ configured: true, deleted: false, reason: 'Could not delete the document.' }, { status: 500 });
  }

  return NextResponse.json({ configured: true, deleted: true });
}
