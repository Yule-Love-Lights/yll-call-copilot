// Bridge-only append of one finalized customer-call utterance. The database
// stores immutable, idempotent segments and updates the UI transcript cache
// while holding the live-session lock, so an end-call request cannot race a
// late segment into a lost transcript.

import { NextResponse } from 'next/server';
import { verifyHeaderSecret } from '@/lib/auth/machine';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { generateCoachCard } from '@/lib/live/card';
import { createLiveEngineState, detectTriggers, type LiveEngineState, type TriggerType } from '@/lib/live/engine';
import type { LeadRow } from '@/lib/leads/types';
import type { Playbook, VerticalRow } from '@/lib/playbook/types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SegmentInput = {
  sessionId: string;
  sourceSegmentId: string;
  speaker: 'rep' | 'customer';
  text: string;
  atMs: number;
  silenceMs: number | null;
};

type AppendResult = {
  result_code: 'saved' | 'already_saved' | 'invalid_input' | 'not_authorized' | 'actor_inactive';
  segment_id: string | null;
  call_id: string | null;
  ordinal: number | null;
  at_ms: number | null;
  transcript_running: string | null;
  inserted: boolean;
};

function validateBody(body: unknown): SegmentInput | null {
  if (!body || typeof body !== 'object') return null;
  const value = body as Record<string, unknown>;
  const sessionId = typeof value.sessionId === 'string' ? value.sessionId.trim() : '';
  const sourceSegmentId = typeof value.sourceSegmentId === 'string' ? value.sourceSegmentId.trim() : '';
  const speaker = value.speaker === 'rep' || value.speaker === 'customer' ? value.speaker : null;
  const text = typeof value.text === 'string' ? value.text.trim() : '';
  const atMs = typeof value.atMs === 'number' && Number.isInteger(value.atMs) && value.atMs >= 0 ? value.atMs : null;
  const silenceMs = value.silenceMs === undefined || value.silenceMs === null
    ? null
    : typeof value.silenceMs === 'number' && Number.isInteger(value.silenceMs) && value.silenceMs >= 0
      ? value.silenceMs
      : -1;
  if (!UUID_PATTERN.test(sessionId) || !UUID_PATTERN.test(sourceSegmentId) || !speaker || !text || atMs === null || silenceMs === -1) {
    return null;
  }
  return { sessionId, sourceSegmentId, speaker, text, atMs, silenceMs };
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }
  const bridgeAuth = verifyHeaderSecret(request, 'x-live-bridge-secret', process.env.LIVE_BRIDGE_SECRET);
  if (bridgeAuth === 'unconfigured') {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }
  if (bridgeAuth !== 'authorized') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const input = validateBody(await request.json().catch(() => null));
  if (!input) {
    return NextResponse.json({ configured: true, saved: false, error: 'Invalid segment.' }, { status: 400 });
  }

  const supabase = getSupabaseServerClient()!;
  const { data, error } = await supabase.rpc('append_authorized_live_segment', {
    p_session_id: input.sessionId,
    p_source_segment_id: input.sourceSegmentId,
    p_speaker: input.speaker,
    p_body: input.text,
    p_at_ms: input.atMs,
    p_silence_ms: input.silenceMs,
  });
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ configured: true, saved: false, migrated: false, reason: 'Run migration 0020 first.' });
    }
    console.error('Append live segment failed:', error);
    return NextResponse.json({ configured: true, saved: false, error: 'Could not store the live segment.' }, { status: 500 });
  }

  const result = (Array.isArray(data) ? data[0] : data) as AppendResult | null;
  if (!result || result.result_code === 'invalid_input') {
    return NextResponse.json({ configured: true, saved: false, error: 'Invalid segment.' }, { status: 400 });
  }
  if (result.result_code === 'not_authorized' || result.result_code === 'actor_inactive') {
    return NextResponse.json({ configured: true, saved: false, error: 'Stream authorization required.' }, { status: 403 });
  }
  if (!result.inserted) {
    return NextResponse.json({ configured: true, saved: true, duplicate: true, atMs: result.at_ms, triggers: [], card: null });
  }
  if (!result.segment_id || !result.call_id || result.at_ms === null || result.transcript_running === null) {
    return NextResponse.json({ configured: true, saved: false, error: 'Could not store the live segment.' }, { status: 500 });
  }

  const { data: priorEvents } = await supabase
    .from('coaching_events')
    .select('trigger, at_ms')
    .eq('call_id', result.call_id);
  const state: LiveEngineState = createLiveEngineState();
  for (const row of (priorEvents ?? []) as { trigger: string; at_ms: number }[]) {
    const type = row.trigger as TriggerType;
    const existing = state.lastFiredAtMs[type];
    if (existing === undefined || row.at_ms > existing) state.lastFiredAtMs[type] = row.at_ms;
  }
  const triggers = detectTriggers({
    speaker: input.speaker,
    text: input.text,
    atMs: result.at_ms,
    silenceMs: input.silenceMs ?? undefined,
  }, state);

  let card: { card: string; expanded: string } | null = null;
  let cardError: string | null = null;
  if (triggers.length > 0) {
    let playbook: Playbook | null = null;
    const { data: callData } = await supabase.from('calls').select('lead_id').eq('id', result.call_id).maybeSingle();
    const leadId = (callData as { lead_id?: string | null } | null)?.lead_id ?? null;
    if (leadId) {
      const { data: leadData } = await supabase.from('leads').select('vertical_slug').eq('id', leadId).maybeSingle();
      const verticalSlug = (leadData as Pick<LeadRow, 'vertical_slug'> | null)?.vertical_slug ?? null;
      if (verticalSlug) {
        const { data: verticalData } = await supabase
          .from('verticals')
          .select('id, active_version')
          .eq('slug', verticalSlug)
          .maybeSingle();
        const vertical = verticalData as Pick<VerticalRow, 'id' | 'active_version'> | null;
        if (vertical && vertical.active_version > 0) {
          const { data: versionData } = await supabase
            .from('playbook_versions')
            .select('content')
            .eq('vertical_id', vertical.id)
            .eq('version', vertical.active_version)
            .maybeSingle();
          playbook = (versionData as { content: Playbook } | null)?.content ?? null;
        }
      }
    }

    try {
      card = await generateCoachCard({
        trigger: triggers[0],
        rollingTranscript: result.transcript_running,
        playbook,
      });
      const { error: insertError } = await supabase.from('coaching_events').insert({
        call_id: result.call_id,
        live_segment_id: result.segment_id,
        at_ms: triggers[0].atMs,
        trigger: triggers[0].type,
        card_text: card.card,
        expanded_text: card.expanded,
      });
      if (insertError && insertError.code !== '23505') throw insertError;
      if (insertError?.code === '23505') card = null;
    } catch (caught) {
      console.error('Generate coaching card failed:', caught);
      card = null;
      cardError = caught instanceof Error ? caught.message : 'Could not generate a coaching card.';
    }
  }

  return NextResponse.json({
    configured: true,
    saved: true,
    atMs: result.at_ms,
    triggers: triggers.map(trigger => trigger.type),
    card,
    cardError,
  });
}
