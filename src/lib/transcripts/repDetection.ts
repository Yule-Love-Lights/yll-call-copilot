// Corpus-wide rep detection for RingCentral transcripts (see ringcentral.ts):
// there is no reliable in-file label for which of a call's speakers is the
// YLL rep and which is the customer, but across the WHOLE export a rep's
// name recurs as a speaker in hundreds of files while a customer's appears
// in roughly one (occasionally a handful, for a customer who called back a
// few times in a season). A name crossing `minFileCount` distinct FILES
// (not turn occurrences -- a rep speaking 40 times in one call must not
// inflate its own count) is treated as a rep. Pure and file-count-based so
// it's cheap to unit test with synthetic frequency data and cheap to run
// once per ingest over ~1,600 real files.
//
// Threshold caveat, confirmed against the real corpus (2026-07): at the
// default of 5, roughly three dozen names cross it. The top handful (in the
// hundreds to 1,000+ files) are unambiguous reps; a long tail sits at 6-16
// files, which is plausibly a mix of lower-volume reps and a few high-touch
// repeat customers (several calls across one season). A pure frequency
// threshold can't fully separate those two cases -- when a transcript's
// only two speakers are BOTH swept into this set, pickCustomerName
// (ringcentral.ts) falls back to null, which just skips outcome-matching
// for that transcript; Claude extraction still runs fine on a null
// customer_name. Callers who see this happening a lot for their data can
// raise `minFileCount` via opts.

export type BuildRepNameSetOptions = {
  minFileCount?: number;
};

const DEFAULT_MIN_FILE_COUNT = 5;

export function buildRepNameSet(
  fileSpeakerSets: string[][],
  opts: BuildRepNameSetOptions = {},
): Set<string> {
  const minFileCount = opts.minFileCount ?? DEFAULT_MIN_FILE_COUNT;
  const fileCountByName = new Map<string, number>();

  for (const speakers of fileSpeakerSets) {
    // Dedup within a file first: a name occurring more than once in the
    // same file's speaker list must still only count once toward its FILE
    // count, not its turn count.
    for (const name of new Set(speakers)) {
      fileCountByName.set(name, (fileCountByName.get(name) ?? 0) + 1);
    }
  }

  const reps = new Set<string>();
  for (const [name, count] of fileCountByName) {
    if (count > minFileCount) reps.add(name);
  }
  return reps;
}
