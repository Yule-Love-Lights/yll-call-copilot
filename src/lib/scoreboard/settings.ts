// I/O for coach_settings (0011) — the scoreboard's team_board_enabled
// switch + onboarding_started_at stamp. Thin reads/writes; the visibility
// math itself lives in visibility.ts and is unit-tested there.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '../supabase';

export type CoachSettings = { teamBoardEnabled: boolean; onboardingStartedAt: string | null };

type CoachSettingsRow = { team_board_enabled: boolean; onboarding_started_at: string | null };

export type LoadCoachSettingsResult = { ok: true; settings: CoachSettings } | { ok: false; missingTable: boolean };

export async function loadCoachSettings(supabase: SupabaseClient): Promise<LoadCoachSettingsResult> {
  const { data, error } = await supabase.from('coach_settings').select('team_board_enabled, onboarding_started_at').eq('id', 1).maybeSingle();
  if (error) {
    if (!isMissingTableError(error)) console.error('Load coach_settings failed:', error);
    return { ok: false, missingTable: isMissingTableError(error) };
  }
  if (!data) {
    // Table migrated but the singleton seed row is missing (a fresh DB
    // before the migration's INSERT ran) — default to the conservative
    // state (private/onboarding), same "unreadable config degrades to the
    // safe default" convention as the rest of this app.
    return { ok: true, settings: { teamBoardEnabled: false, onboardingStartedAt: null } };
  }
  const row = data as CoachSettingsRow;
  return { ok: true, settings: { teamBoardEnabled: row.team_board_enabled, onboardingStartedAt: row.onboarding_started_at } };
}

export type UpdateCoachSettingsResult = { ok: true; settings: CoachSettings } | { ok: false; missingTable: boolean };

// Turning the board OFF (private) always (re-)stamps onboarding_started_at —
// the start of the current private cycle, whether it's the very first one
// or a reset (e.g. a batch of new hires). Turning it ON leaves the stamp
// alone; isOnboardingPromptDue only ever consults it while still private.
export async function setTeamBoardEnabled(supabase: SupabaseClient, enabled: boolean, asOf: Date): Promise<UpdateCoachSettingsResult> {
  const update: { team_board_enabled: boolean; updated_at: string; onboarding_started_at?: string } = {
    team_board_enabled: enabled,
    updated_at: asOf.toISOString(),
  };
  if (!enabled) update.onboarding_started_at = asOf.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('coach_settings')
    .update(update)
    .eq('id', 1)
    .select('team_board_enabled, onboarding_started_at')
    .maybeSingle();
  if (error) {
    if (!isMissingTableError(error)) console.error('Update coach_settings failed:', error);
    return { ok: false, missingTable: isMissingTableError(error) };
  }
  if (data) {
    const row = data as CoachSettingsRow;
    return { ok: true, settings: { teamBoardEnabled: row.team_board_enabled, onboardingStartedAt: row.onboarding_started_at } };
  }

  // No row yet (pre-seed, or the seed insert never ran) — insert the
  // singleton instead of failing the toggle.
  const { data: inserted, error: insertError } = await supabase
    .from('coach_settings')
    .insert({ id: 1, ...update })
    .select('team_board_enabled, onboarding_started_at')
    .maybeSingle();
  if (insertError || !inserted) {
    console.error('Insert coach_settings failed:', insertError);
    return { ok: false, missingTable: false };
  }
  const row = inserted as CoachSettingsRow;
  return { ok: true, settings: { teamBoardEnabled: row.team_board_enabled, onboardingStartedAt: row.onboarding_started_at } };
}
