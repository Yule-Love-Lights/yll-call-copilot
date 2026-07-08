// GET/POST /api/verticals/[id]/documents — per-vertical knowledge
// documents. GET lists them (a content preview only — the full text is
// only needed server-side, by generate.ts). POST uploads one .md/.txt/.pdf
// file: markdown/text is stored as-is, PDF text is extracted with
// pdf-parse. Deleting lives at DELETE /api/documents/[id] since a document
// isn't scoped by vertical in that URL.

import { NextResponse } from 'next/server';
import { PDFParse } from 'pdf-parse';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import type { DocumentRow } from '@/lib/transcripts/types';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, documents: [] });
  }

  const { id } = await params;
  const supabase = getSupabaseServerClient()!;

  const { data, error } = await supabase
    .from('documents')
    .select('id, title, kind, content, created_at')
    .eq('vertical_id', id)
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, migrated: false, documents: [], reason: 'Run migration 0003 first.' });
    }
    console.error('List documents failed:', error);
    return NextResponse.json({ configured: true, documents: [], error: 'Could not load documents.' }, { status: 500 });
  }

  const rows = (data ?? []) as Pick<DocumentRow, 'id' | 'title' | 'kind' | 'content' | 'created_at'>[];
  return NextResponse.json({
    configured: true,
    documents: rows.map(d => ({
      id: d.id,
      title: d.title,
      kind: d.kind,
      contentPreview: d.content.length > 300 ? `${d.content.slice(0, 300)}…` : d.content,
      createdAt: d.created_at,
    })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false, reason: 'Supabase not configured.' });
  }

  const { id } = await params;
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ configured: true, saved: false, reason: 'Invalid form data.' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ configured: true, saved: false, reason: 'file is required.' }, { status: 400 });
  }

  const lower = file.name.toLowerCase();
  let content: string;
  try {
    if (lower.endsWith('.pdf')) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const parser = new PDFParse({ data: buffer });
      try {
        content = (await parser.getText()).text;
      } finally {
        await parser.destroy();
      }
    } else if (lower.endsWith('.md') || lower.endsWith('.txt')) {
      content = await file.text();
    } else {
      return NextResponse.json(
        { configured: true, saved: false, reason: 'Only .md, .txt, and .pdf files are supported.' },
        { status: 400 },
      );
    }
  } catch (err) {
    console.error('Document text extraction failed:', err);
    return NextResponse.json({ configured: true, saved: false, reason: 'Could not read that file.' }, { status: 400 });
  }

  if (!content.trim()) {
    return NextResponse.json(
      { configured: true, saved: false, reason: 'That file had no extractable text.' },
      { status: 400 },
    );
  }

  const titleField = formData.get('title');
  const title = typeof titleField === 'string' && titleField.trim() ? titleField.trim() : file.name;

  const supabase = getSupabaseServerClient()!;
  const { data, error } = await supabase
    .from('documents')
    .insert({ vertical_id: id, title, kind: 'upload', content })
    .select('id, title, kind, created_at')
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, saved: false, reason: 'Run migration 0003 first.' });
    }
    console.error('Store document failed:', error);
    return NextResponse.json({ configured: true, saved: false, reason: 'Could not store the document.' }, { status: 500 });
  }

  const doc = data as Pick<DocumentRow, 'id' | 'title' | 'kind' | 'created_at'>;
  return NextResponse.json({
    configured: true,
    saved: true,
    document: { id: doc.id, title: doc.title, kind: doc.kind, createdAt: doc.created_at },
  });
}
