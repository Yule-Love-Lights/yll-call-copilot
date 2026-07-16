// The scorecard rubric: Settings-editable and versioned exactly like
// playbooks (playbook/versions.ts) -- active rubric = highest version, a
// Settings edit inserts a new version, rollback is just re-saving an older
// version's content as a new one. SEEDED_RUBRIC mirrors the version-1 seed
// row inserted directly by supabase/migrations/0008_scoring.sql (a migration
// can't import TypeScript, so the two are kept in sync by hand) -- it also
// doubles as getActiveRubric's defensive fallback for the case where the
// table is reachable but somehow has no rows yet.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '../supabase';
import {
  HOSPITALITY_DIM_KEYS,
  SALES_DIM_KEYS,
  type RubricContent,
  type RubricDim,
  type RubricSource,
} from './types';

export const SEEDED_RUBRIC: RubricContent = {
  master:
    "Read which of the four emotional states the customer is in inside the first thirty seconds: excited (run the vision-first track), busy (run the done-for-you track), guarded (run the proof-and-guarantees track), or status-driven (run the ambition-match track). Name the state back to the customer in your own words, then run the matching track. This is graded on its own, before discovery, because it is the master skill that decides whether the rest of the call lands.",
  sales: [
    {
      key: 'opening',
      name: 'Opening and rapport',
      weight: 15,
      instructions:
        "Branded warm greeting: company name, the rep's first name, an open question. Never a bare hello. Get the caller's name early and use it once or twice naturally, not on every line.",
    },
    {
      key: 'discovery',
      name: 'Discovery depth',
      weight: 25,
      instructions:
        "Ask two or three real discovery questions before any numbers, including the emotional why: what is the occasion, what would it look like done right, what matters most to them. Acknowledge before answering ('that makes sense', 'I hear you') instead of jumping straight to a response.",
    },
    {
      key: 'value',
      name: 'Value presentation and price confidence',
      weight: 20,
      instructions:
        'Build value before price: raise the dream outcome and the proof (photos, guarantees, past jobs on their street), lower the perceived time and effort. Never blurt a price cold and never dodge it either; state the number level and unhurried once value is built.',
    },
    {
      key: 'objections',
      name: 'Objection handling',
      weight: 20,
      instructions:
        "Use the playbook's approved responses. Treat 'let me think about it' as a discovery gap, not a rejection -- ask one more question to find the real hesitation instead of accepting it at face value.",
    },
    {
      key: 'close',
      name: 'Close',
      weight: 20,
      instructions:
        "Ask for the booking with a binary choice ('Tuesday morning or Thursday afternoon, which is better'). Confirm every decision-maker will be there. Recap the booking back: name, address, window, what happens next.",
    },
  ],
  hospitality: [
    {
      key: 'greeting',
      name: 'Greeting quality and warmth',
      weight: 20,
      instructions: 'A warm, branded, unhurried opening. The caller should feel like a person, not a ticket number.',
    },
    {
      key: 'listening',
      name: 'Active listening',
      weight: 20,
      instructions: 'Acknowledgment phrases used, the customer never talked over or rushed. Count interruptions as a hard number, not a vibe.',
    },
    {
      key: 'courtesy',
      name: 'Courtesy language',
      weight: 20,
      instructions:
        "The my-pleasure standard: 'may I place you on a brief hold' not 'hold on', 'my pleasure' not 'no problem'. Never short or curt, even on a no.",
    },
    {
      key: 'dead_air',
      name: 'Dead air and interruptions',
      weight: 20,
      instructions: 'Measure actual seconds of silence and interruption counts, not impression. Long dead air reads as the rep being lost or distracted.',
    },
    {
      key: 'warm_ending',
      name: 'Warm ending',
      weight: 20,
      instructions:
        "End every call warmly, especially the noes. The last 15 seconds shape the whole call's memory. Personalize the close with something the customer said and leave the door open by name.",
    },
  ],
  experience: {
    instructions:
      'A 10 out of 10 call leaves the customer feeling three things at once: genuinely cared for, at ease and confident (zero pressure), and excited about the vision for their own home. This is the top of the scorecard, weighted above whether the deal closed that day -- a warm no can outscore a pushy yes.',
  },
  guarantees_note:
    "Grade whether the rep said the guarantees that actually fit this call: the 48-hour fast-fix window, all-inclusive pricing ('the quote is the bill'), the lease-vs-own disclosure on holiday, the 3-year labor warranty on permanent, the referral offer to a happy customer, the rebook lock at takedown, and the permanent-lighting seed only when the fit was really there (past holiday customer, takedown call, a ladder-averse homeowner). Never grade an element that does not apply to this call.",
  hard_metrics: { rep_talk_ratio_target: 0.43 },
  weighting: { experience: 0.4, sales: 0.35, hospitality: 0.25 },
};

// ─── Validation ─────────────────────────────────────────────────────────────

function isString(v: unknown): v is string {
  return typeof v === 'string';
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isRubricDim(v: unknown): v is RubricDim {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Record<string, unknown>;
  return isString(d.key) && isString(d.name) && isFiniteNumber(d.weight) && isString(d.instructions);
}

function dimSectionError(
  label: string,
  value: unknown,
  requiredKeys: readonly string[],
): string | null {
  if (!Array.isArray(value) || !value.every(isRubricDim)) {
    return `${label} must be an array of { key, name, weight, instructions }.`;
  }
  const keys = value.map(d => (d as RubricDim).key);
  const missing = requiredKeys.filter(k => !keys.includes(k));
  if (missing.length > 0) {
    return `${label} is missing required dimensions: ${missing.join(', ')}.`;
  }
  const total = value.reduce((sum, d) => sum + (d as RubricDim).weight, 0);
  if (Math.abs(total - 100) > 0.001) {
    return `${label} weights must sum to 100 (got ${total}).`;
  }
  return null;
}

export type RubricValidationResult = { valid: true; rubric: RubricContent } | { valid: false; error: string };

export function validateRubricContent(value: unknown): RubricValidationResult {
  if (typeof value !== 'object' || value === null) {
    return { valid: false, error: 'Rubric must be an object.' };
  }
  const v = value as Record<string, unknown>;

  if (!isString(v.master)) {
    return { valid: false, error: 'master must be a string.' };
  }

  const salesError = dimSectionError('sales', v.sales, SALES_DIM_KEYS);
  if (salesError) return { valid: false, error: salesError };

  const hospitalityError = dimSectionError('hospitality', v.hospitality, HOSPITALITY_DIM_KEYS);
  if (hospitalityError) return { valid: false, error: hospitalityError };

  if (typeof v.experience !== 'object' || v.experience === null || !isString((v.experience as Record<string, unknown>).instructions)) {
    return { valid: false, error: 'experience must be { instructions }.' };
  }
  if (!isString(v.guarantees_note)) {
    return { valid: false, error: 'guarantees_note must be a string.' };
  }
  if (
    typeof v.hard_metrics !== 'object' ||
    v.hard_metrics === null ||
    !isFiniteNumber((v.hard_metrics as Record<string, unknown>).rep_talk_ratio_target)
  ) {
    return { valid: false, error: 'hard_metrics must be { rep_talk_ratio_target }.' };
  }

  const weighting = v.weighting as Record<string, unknown> | undefined;
  if (
    typeof weighting !== 'object' ||
    weighting === null ||
    !isFiniteNumber(weighting.experience) ||
    !isFiniteNumber(weighting.sales) ||
    !isFiniteNumber(weighting.hospitality)
  ) {
    return { valid: false, error: 'weighting must be { experience, sales, hospitality } numbers.' };
  }
  const weightingTotal = (weighting.experience as number) + (weighting.sales as number) + (weighting.hospitality as number);
  if (Math.abs(weightingTotal - 1) > 0.0001) {
    return { valid: false, error: `weighting must sum to 1.0 (got ${weightingTotal}).` };
  }

  return {
    valid: true,
    rubric: {
      master: v.master as string,
      sales: v.sales as RubricDim[],
      hospitality: v.hospitality as RubricDim[],
      experience: v.experience as { instructions: string },
      guarantees_note: v.guarantees_note as string,
      hard_metrics: v.hard_metrics as { rep_talk_ratio_target: number },
      weighting: weighting as { experience: number; sales: number; hospitality: number },
    },
  };
}

// ─── Reading and saving ─────────────────────────────────────────────────────

export type ActiveRubricResult =
  | { ok: true; version: number; source: RubricSource; content: RubricContent }
  | { ok: false; missingTable: true }
  | { ok: false; missingTable: false; reason: string };

export async function getActiveRubric(supabase: SupabaseClient): Promise<ActiveRubricResult> {
  const { data, error } = await supabase
    .from('rubric_versions')
    .select('version, content, source')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) return { ok: false, missingTable: true };
    return { ok: false, missingTable: false, reason: 'Could not load the active rubric.' };
  }
  if (!data) {
    // Defensive only -- the migration always seeds version 1, so an empty
    // table should not happen outside a test/mock, but scoring must never
    // hard-block on it.
    return { ok: true, version: 0, source: 'seeded', content: SEEDED_RUBRIC };
  }
  const row = data as { version: number; content: RubricContent; source: RubricSource };
  return { ok: true, version: row.version, source: row.source, content: row.content };
}

export type SaveRubricResult =
  | { ok: true; version: number }
  | { ok: false; status: number; reason: string; missingTable?: boolean };

const UNIQUE_VIOLATION = '23505';
const MAX_ATTEMPTS = 2;
const COLLISION_REASON = 'Another change was saved to the rubric at the same time. Please try again.';
const MISSING_TABLE_REASON = 'Run migration 0008 first.';

// Validates, then inserts version (currentMax + 1) with source 'edited'.
// Retries once on a version-number collision (a concurrent save landed
// first) by re-reading the fresh max version -- same shape as
// publishPlaybookVersion (playbook/versions.ts), simplified: there is no
// second table to update since "active" is just "highest version" here.
export async function saveRubricEdit(supabase: SupabaseClient, content: unknown): Promise<SaveRubricResult> {
  const validated = validateRubricContent(content);
  if (!validated.valid) {
    return { ok: false, status: 400, reason: validated.error };
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { data, error: readError } = await supabase
      .from('rubric_versions')
      .select('version')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (readError) {
      if (isMissingTableError(readError)) {
        return { ok: false, status: 200, reason: MISSING_TABLE_REASON, missingTable: true };
      }
      return { ok: false, status: 500, reason: 'Could not load the current rubric version.' };
    }
    const currentVersion = (data as { version: number } | null)?.version ?? 0;
    const nextVersion = currentVersion + 1;

    const { error: insertError } = await supabase
      .from('rubric_versions')
      .insert({ version: nextVersion, content: validated.rubric, source: 'edited' });

    if (insertError) {
      if (insertError.code === UNIQUE_VIOLATION) {
        if (attempt < MAX_ATTEMPTS) continue;
        return { ok: false, status: 409, reason: COLLISION_REASON };
      }
      if (isMissingTableError(insertError)) {
        return { ok: false, status: 200, reason: MISSING_TABLE_REASON, missingTable: true };
      }
      return { ok: false, status: 500, reason: 'Could not store the rubric.' };
    }

    return { ok: true, version: nextVersion };
  }

  return { ok: false, status: 409, reason: COLLISION_REASON };
}
