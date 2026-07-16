// Pure sync-window math for the nightly GHL recordings sync (see
// src/app/api/cron/sync-recordings/route.ts). Kept separate from the DB/GHL
// IO so "since when do we ask GHL for calls" is unit-testable without a
// live database or a live GHL account.

const FIRST_RUN_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// The first run has no recording_sync_state row yet (lastSyncedAt null) --
// default to a 7-day lookback so the first nightly sync backfills a
// reasonable window of recent calls instead of pulling the account's entire
// history. Every later run passes the previous run's stored
// last_synced_at, narrowing the window to just what's new.
export function resolveSyncWindowStart(lastSyncedAt: string | null, now: Date = new Date()): string {
  if (lastSyncedAt) return lastSyncedAt;
  return new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS).toISOString();
}

// How many pending recordings a single cron/continue invocation processes.
// Shared by both routes so "process the next batch" means the same thing
// whether it's the nightly cron or a staff click.
export const RECORDING_BATCH_SIZE = 6;

// Below this, a call is never worth a Deepgram transcription -- a dropped
// call, a wrong number hung up in seconds, etc. Checked against the
// duration GHL itself reports for the call message, BEFORE downloading or
// transcribing, so those calls never spend a Deepgram credit. The
// post-transcription junk detector (junkReasonForTurns) catches everything
// duration alone can't (voicemail/IVR, one-sided calls).
export const MIN_RECORDING_SECONDS = 20;
