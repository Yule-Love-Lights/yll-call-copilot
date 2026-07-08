// Pure helpers shared by the ingest routes (POST /api/ingest/transcripts and
// POST /api/ingest/continue). The actual DB/GHL/Claude work only happens in
// the routes — this file holds the one decision that's worth unit-testing
// without a live database: which transcripts to process in the next batch,
// and whether the job is done after it.

// A request-scoped batch of 25 keeps a single ingest request well under
// Next's execution limits even for a ~2000-transcript upload; the UI polls
// /api/ingest/continue in a loop until the job reports done.
export const BATCH_SIZE = 25;

export type BatchPlan = {
  batch: string[];
  remainingAfterBatch: number;
  jobDone: boolean;
};

export function selectNextBatch(
  transcriptIds: string[],
  alreadyProcessedIds: ReadonlySet<string>,
  batchSize: number = BATCH_SIZE,
): BatchPlan {
  const pending = transcriptIds.filter(id => !alreadyProcessedIds.has(id));
  const batch = pending.slice(0, batchSize);
  const remainingAfterBatch = pending.length - batch.length;
  return { batch, remainingAfterBatch, jobDone: remainingAfterBatch === 0 };
}

// The gap between sequential GHL calls during outcome matching, so a
// several-thousand-transcript ingest doesn't hammer the rate limit.
export const GHL_RATE_LIMIT_GAP_MS = 150;

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
