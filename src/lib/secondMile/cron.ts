// Orchestrates GET /api/cron/second-mile: the personal-touch scan over
// recent transcripts, the December 10-25 cookies+ornament run, and the
// reveal-photo prompt -- all reading from the shared "installed/won this
// season" contact set (./installedContacts.ts). Every insert goes through
// upsert(..., {onConflict: 'dedupe_key', ignoreDuplicates: true}) so a
// retried or nightly-repeated run never creates a duplicate row and never
// resets a touch a human already marked done/skipped back to pending -- see
// candidates.ts's dedupeAgainstExisting for the same guarantee proven at
// the unit level. Best-effort throughout: one transcript's scan failing
// does not stop the rest of the batch or the cookies/reveal steps.

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildCookiesOrnamentCandidates, buildPersonalTouchCandidate, buildRevealPhotoCandidates } from './candidates';
import { getSeasonYear, isWithinCookiesOrnamentWindow } from './decemberWindow';
import { getInstalledWonContacts, type InstalledContactsSource } from './installedContacts';
import { scanPersonalTouches } from './personalTouches';

// Up to 10 transcripts per run, oldest-first within the last 3 days (AGENTS
// spec point 3a). A transcript not yet scanned stays eligible on the next
// run if this run doesn't get to it.
const SCAN_WINDOW_DAYS = 3;
const MAX_TRANSCRIPTS_PER_RUN = 10;

export type SecondMileCronResult = {
  transcriptsScanned: number;
  personalTouchesCreated: number;
  cookiesOrnamentWindowActive: boolean;
  cookiesOrnamentCreated: number;
  revealPhotoCreated: number;
  installedContactsSource: InstalledContactsSource;
  installedContactsCount: number;
};

type TranscriptForScan = {
  id: string;
  raw_text: string;
  customer_name: string | null;
  ghl_contact_id: string | null;
};

async function scanRecentTranscripts(supabase: SupabaseClient, now: Date): Promise<{ scanned: number; created: number }> {
  const sinceIso = new Date(now.getTime() - SCAN_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: recentRows, error: recentError } = await supabase
    .from('transcripts')
    .select('id, raw_text, customer_name, ghl_contact_id, created_at')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true });
  if (recentError) {
    console.error('Load recent transcripts for second-mile scan failed:', recentError);
    return { scanned: 0, created: 0 };
  }

  const { data: scannedRows, error: scannedError } = await supabase.from('second_mile_scans').select('transcript_id');
  if (scannedError) {
    console.error('Load second_mile_scans failed:', scannedError);
    return { scanned: 0, created: 0 };
  }
  const alreadyScanned = new Set((scannedRows ?? []).map(r => (r as { transcript_id: string }).transcript_id));

  const toScan = ((recentRows ?? []) as TranscriptForScan[])
    .filter(t => !alreadyScanned.has(t.id))
    .slice(0, MAX_TRANSCRIPTS_PER_RUN);

  let scanned = 0;
  let created = 0;

  for (const transcript of toScan) {
    try {
      const touches = await scanPersonalTouches(transcript.raw_text, transcript.customer_name);
      scanned++;

      if (touches.length > 0) {
        const candidates = touches.map(touch =>
          buildPersonalTouchCandidate({
            transcriptId: transcript.id,
            ghlContactId: transcript.ghl_contact_id,
            customerName: transcript.customer_name,
            touch,
            now,
          }),
        );
        const { data: inserted, error: insertError } = await supabase
          .from('second_mile_touches')
          .upsert(candidates, { onConflict: 'dedupe_key', ignoreDuplicates: true })
          .select('id');
        if (insertError) console.error(`Insert personal-touch rows for transcript ${transcript.id} failed:`, insertError);
        else created += inserted?.length ?? 0;
      }

      const { error: markError } = await supabase
        .from('second_mile_scans')
        .upsert({ transcript_id: transcript.id, touches_found: touches.length }, { onConflict: 'transcript_id', ignoreDuplicates: true });
      if (markError) console.error(`Mark transcript ${transcript.id} scanned failed:`, markError);
    } catch (err) {
      console.error(`Personal-touch scan failed for transcript ${transcript.id}:`, err);
    }
  }

  return { scanned, created };
}

export async function runSecondMileCron(supabase: SupabaseClient, now: Date = new Date()): Promise<SecondMileCronResult> {
  const { scanned, created: personalTouchesCreated } = await scanRecentTranscripts(supabase, now);

  const seasonYear = getSeasonYear(now);
  const { contacts, source } = await getInstalledWonContacts(supabase, seasonYear);

  // The reveal-photo prompt is created every run (not gated to the December
  // window) -- an install needs its reveal shot whenever it happens, holiday
  // season or not. Only the cookies+ornament run below is gated to Dec
  // 10-25, per AGENTS spec point 3b; both draw from the same fetched set.
  const windowActive = isWithinCookiesOrnamentWindow(now);
  let cookiesOrnamentCreated = 0;
  if (windowActive) {
    const candidates = buildCookiesOrnamentCandidates(contacts, seasonYear, now);
    if (candidates.length > 0) {
      const { data: inserted, error } = await supabase
        .from('second_mile_touches')
        .upsert(candidates, { onConflict: 'dedupe_key', ignoreDuplicates: true })
        .select('id');
      if (error) console.error('Insert cookies_ornament rows failed:', error);
      else cookiesOrnamentCreated = inserted?.length ?? 0;
    }
  }

  let revealPhotoCreated = 0;
  const revealCandidates = buildRevealPhotoCandidates(contacts, now);
  if (revealCandidates.length > 0) {
    const { data: inserted, error } = await supabase
      .from('second_mile_touches')
      .upsert(revealCandidates, { onConflict: 'dedupe_key', ignoreDuplicates: true })
      .select('id');
    if (error) console.error('Insert reveal_photo rows failed:', error);
    else revealPhotoCreated = inserted?.length ?? 0;
  }

  return {
    transcriptsScanned: scanned,
    personalTouchesCreated,
    cookiesOrnamentWindowActive: windowActive,
    cookiesOrnamentCreated,
    revealPhotoCreated,
    installedContactsSource: source,
    installedContactsCount: contacts.length,
  };
}
