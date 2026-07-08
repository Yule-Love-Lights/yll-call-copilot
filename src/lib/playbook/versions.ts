// Shared "publish the next playbook version" step: read active_version,
// insert the next playbook_versions row, bump verticals.active_version.
// Factored out of POST /api/proposals/[id]/decide,
// POST /api/verticals/[id]/generate, and PUT /api/verticals/[id]/playbook,
// which each did this identical unguarded read-modify-write with no
// transaction, row lock, or optimistic-concurrency check — so two of them
// racing on the same vertical (e.g. a rep approving two different pending
// proposals back to back) would both compute the same "next" version
// number and collide on playbook_versions' unique(vertical_id, version)
// constraint, throwing a generic 500 for whichever lost the race.
//
// On that collision (Postgres 23505), this re-reads the now-current
// active_version and retries ONCE before giving up with a 409 the caller
// can show the rep, instead of a 500 that silently discards the loser's
// work.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Playbook } from './types';

export type PublishSource = 'generated' | 'edited';

export type PublishVersionResult = { ok: true; version: number } | { ok: false; status: number; reason: string };

// What the caller wants published, resolved fresh on every attempt (not a
// plain Playbook) — required by POST /api/proposals/[id]/decide, whose
// content depends on applying a proposal to whatever the CURRENT playbook
// is: a retry must recompute against the freshly re-read active_version,
// not replay a stale one. `{ ok: false }` is a real business-state failure
// (not a race) and is returned immediately, without a retry.
export type ContentResolution = { ok: true; playbook: Playbook } | { ok: false; error: string; status?: number };

const UNIQUE_VIOLATION = '23505';
const MAX_ATTEMPTS = 2;
const COLLISION_REASON = 'Another change was published for this vertical at the same time. Please try again.';

export async function publishPlaybookVersion(
  supabase: SupabaseClient,
  verticalId: string,
  source: PublishSource,
  resolveContent: (activeVersion: number) => Promise<ContentResolution> | ContentResolution,
): Promise<PublishVersionResult> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { data: verticalData, error: verticalError } = await supabase
      .from('verticals')
      .select('active_version')
      .eq('id', verticalId)
      .maybeSingle();
    if (verticalError) {
      return { ok: false, status: 500, reason: 'Could not load vertical.' };
    }
    if (!verticalData) {
      return { ok: false, status: 404, reason: 'Vertical not found.' };
    }
    const activeVersion = (verticalData as { active_version: number }).active_version;

    const resolved = await resolveContent(activeVersion);
    if (!resolved.ok) {
      return { ok: false, status: resolved.status ?? 409, reason: resolved.error };
    }

    const nextVersion = activeVersion + 1;
    const { error: insertError } = await supabase
      .from('playbook_versions')
      .insert({ vertical_id: verticalId, version: nextVersion, content: resolved.playbook, source });

    if (insertError) {
      if (insertError.code === UNIQUE_VIOLATION) {
        if (attempt < MAX_ATTEMPTS) continue;
        return { ok: false, status: 409, reason: COLLISION_REASON };
      }
      return { ok: false, status: 500, reason: 'Could not store the playbook.' };
    }

    const { error: updateError } = await supabase
      .from('verticals')
      .update({ active_version: nextVersion })
      .eq('id', verticalId);
    if (updateError) {
      return { ok: false, status: 500, reason: 'Could not activate the saved playbook.' };
    }

    return { ok: true, version: nextVersion };
  }

  return { ok: false, status: 409, reason: COLLISION_REASON };
}
