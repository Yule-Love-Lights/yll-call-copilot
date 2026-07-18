// POST /api/brain/interview -- "Interview yourself" (Wave 1 PR B, Seed the
// Brain): accepts the operator's answers to the curated question bank
// (src/lib/brain/interview.ts) as an array of {question, lens, answer},
// runs ONE Claude call to distill them into structured insights
// (src/lib/brain/distillInterview.ts), then inserts the resulting rows
// (source='interview') PLUS a raw-transcript backstop row -- so nothing the
// operator typed is ever lost, even when distillation returns fewer
// insights than themed questions were answered. Falls back to saving the
// raw answers as manual-style rows (source='manual', one per answered
// question) when Claude is not configured or the distill call fails
// outright, so an interview is never wasted work. Degrades on a missing
// table the same way every other route in this app does.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';
import { isClaudeConfigured } from '@/lib/claude';
import { distillInterview, type InterviewAnswer } from '@/lib/brain/distillInterview';
import { isInsightLens, type BrainInsightRow, type InsightSource } from '@/lib/brain/types';

function parseAnswers(body: unknown): InterviewAnswer[] | null {
  if (!Array.isArray(body)) return null;
  const answers: InterviewAnswer[] = [];
  for (const item of body) {
    if (typeof item !== 'object' || item === null) return null;
    const a = item as Record<string, unknown>;
    if (typeof a.question !== 'string' || !a.question.trim()) return null;
    if (!isInsightLens(a.lens)) return null;
    if (typeof a.answer !== 'string') return null;
    answers.push({ question: a.question, lens: a.lens, answer: a.answer });
  }
  return answers;
}

// The full raw Q&A transcript, verbatim -- the backstop that always
// preserves 100% of what the operator typed regardless of how many (or how
// few) insights distillation produced.
function rawTranscriptContent(answered: InterviewAnswer[]): string {
  return answered.map(a => `Q: ${a.question}\nA: ${a.answer.trim()}`).join('\n\n');
}

type InsertableInsight = { source: InsightSource; lens: InterviewAnswer['lens']; title: string; content: string };

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, saved: false, reason: 'Supabase not configured.' });
  }

  const body = await request.json().catch(() => null);
  const answers = parseAnswers(body);
  if (!answers) {
    return NextResponse.json(
      { configured: true, saved: false, reason: 'Body must be an array of {question, lens, answer}.' },
      { status: 400 },
    );
  }

  const answered = answers.filter(a => a.answer.trim());
  if (answered.length === 0) {
    return NextResponse.json(
      { configured: true, saved: false, reason: 'Answer at least one question first.' },
      { status: 400 },
    );
  }

  let rowsToInsert: InsertableInsight[];

  if (!isClaudeConfigured()) {
    // Claude unavailable: save the raw answers, one row per answered
    // question, rather than losing the interview.
    rowsToInsert = answered.map(a => ({
      source: 'manual',
      lens: a.lens,
      title: a.question.length > 80 ? `${a.question.slice(0, 80)}…` : a.question,
      content: a.answer.trim(),
    }));
  } else {
    let distilled: { lens: InterviewAnswer['lens']; title: string; content: string }[] = [];
    try {
      distilled = await distillInterview(answered);
    } catch (err) {
      // Same backstop as the Claude-unavailable branch: never lose the
      // operator's answers just because distillation itself failed (bad
      // JSON after retries, an API error, etc.) -- the raw row below still
      // saves everything.
      console.error('Interview distillation failed:', err);
    }

    rowsToInsert = distilled.map(d => ({ source: 'interview', lens: d.lens, title: d.title, content: d.content }));
    rowsToInsert.push({
      source: 'interview',
      lens: 'general',
      title: `Interview notes (${new Date().toLocaleDateString('en-US')})`,
      content: rawTranscriptContent(answered),
    });
  }

  const supabase = getSupabaseServerClient()!;
  const createdBy = await getSessionEmail();

  const { data, error } = await supabase
    .from('brain_insights')
    .insert(rowsToInsert.map(r => ({ ...r, vertical_id: null, created_by: createdBy })))
    .select('id, vertical_id, source, lens, title, content, created_by, created_at');

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, saved: false, reason: 'Run migration 0015 first.' });
    }
    console.error('Store interview insights failed:', error);
    return NextResponse.json({ configured: true, saved: false, reason: 'Could not save the interview.' }, { status: 500 });
  }

  const rows = (data ?? []) as BrainInsightRow[];
  return NextResponse.json({
    configured: true,
    saved: true,
    insights: rows.map(r => ({ id: r.id, source: r.source, lens: r.lens, title: r.title, content: r.content, createdAt: r.created_at })),
  });
}
