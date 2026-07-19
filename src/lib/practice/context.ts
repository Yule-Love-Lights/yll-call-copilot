// Small glue between a practice session's saved vertical_slug and the
// customer prompt builder. loadVerticalContext resolves a vertical's name +
// active playbook by slug -- the same lookup scoring/batch.ts's
// loadVerticalContext does inline for real-call scoring, exported here so
// both POST /api/practice/start and POST /api/practice/[id]/turn can rebuild
// the same customer system prompt without duplicating the query.
//
// buildSessionSystemPrompt always reads the CURRENT playbook and offer, not
// a copy frozen at session start -- a rep practicing against today's
// playbook/offer is the point (same "the coach grades against the new
// standard" reasoning rubric.ts documents for scoring).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Playbook, PlaybookVersionRow, VerticalRow } from '../playbook/types';
import { getOfferElements } from '../scoring/batch';
import { buildCustomerSystemPrompt, type EmotionalState } from './customer';

export type VerticalContext = { verticalName: string; playbook: Playbook | null };

export async function loadVerticalContext(supabase: SupabaseClient, verticalSlug: string): Promise<VerticalContext> {
  if (!verticalSlug) return { verticalName: 'Unknown', playbook: null };

  const { data: verticalData } = await supabase
    .from('verticals')
    .select('id, name, active_version')
    .eq('slug', verticalSlug)
    .maybeSingle();
  const vertical = verticalData as Pick<VerticalRow, 'id' | 'name' | 'active_version'> | null;
  if (!vertical) return { verticalName: verticalSlug, playbook: null };

  let playbook: Playbook | null = null;
  if (vertical.active_version > 0) {
    const { data: versionData } = await supabase
      .from('playbook_versions')
      .select('content')
      .eq('vertical_id', vertical.id)
      .eq('version', vertical.active_version)
      .maybeSingle();
    playbook = (versionData as Pick<PlaybookVersionRow, 'content'> | null)?.content ?? null;
  }
  return { verticalName: vertical.name, playbook };
}

export async function buildSessionSystemPrompt(
  supabase: SupabaseClient,
  input: { verticalSlug: string; emotionalState: EmotionalState; objective: string | null },
): Promise<string> {
  const { playbook } = await loadVerticalContext(supabase, input.verticalSlug);
  const offer = await getOfferElements(supabase);
  return buildCustomerSystemPrompt({
    playbook,
    emotionalState: input.emotionalState,
    objective: input.objective,
    offer,
  });
}
