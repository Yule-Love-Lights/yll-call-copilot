// Coverage for the pure ingest batching decision (selectNextBatch) used by
// both /api/ingest/transcripts (the initial batch) and
// /api/ingest/continue (every batch after).

import { describe, it, expect } from 'vitest';
import { BATCH_SIZE, selectNextBatch } from './ingest';

describe('selectNextBatch', () => {
  it('processes everything and marks the job done when under the batch size', () => {
    const ids = ['a', 'b', 'c'];
    const plan = selectNextBatch(ids, new Set());

    expect(plan.batch).toEqual(['a', 'b', 'c']);
    expect(plan.remainingAfterBatch).toBe(0);
    expect(plan.jobDone).toBe(true);
  });

  it('caps the batch at BATCH_SIZE and leaves the job running', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `id-${i}`);
    const plan = selectNextBatch(ids, new Set());

    expect(plan.batch).toHaveLength(BATCH_SIZE);
    expect(plan.batch).toEqual(ids.slice(0, BATCH_SIZE));
    expect(plan.remainingAfterBatch).toBe(30 - BATCH_SIZE);
    expect(plan.jobDone).toBe(false);
  });

  it('skips ids that are already processed, regardless of where they fall in the list', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `id-${i}`);
    // 5 already-processed ids scattered through the list, not just the front.
    const processed = new Set(['id-0', 'id-5', 'id-10', 'id-15', 'id-20']);
    const plan = selectNextBatch(ids, processed, 25);

    expect(plan.batch).toHaveLength(25); // all 25 remaining pending ids fit in one batch
    expect(plan.batch.some(id => processed.has(id))).toBe(false);
    expect(plan.remainingAfterBatch).toBe(0);
    expect(plan.jobDone).toBe(true);
  });

  it('respects a custom batch size', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const plan = selectNextBatch(ids, new Set(), 2);

    expect(plan.batch).toEqual(['a', 'b']);
    expect(plan.remainingAfterBatch).toBe(2);
    expect(plan.jobDone).toBe(false);
  });

  it('returns an empty batch and jobDone true when everything is already processed', () => {
    const ids = ['a', 'b'];
    const plan = selectNextBatch(ids, new Set(['a', 'b']));

    expect(plan.batch).toEqual([]);
    expect(plan.remainingAfterBatch).toBe(0);
    expect(plan.jobDone).toBe(true);
  });

  it('returns jobDone true for an empty id list', () => {
    const plan = selectNextBatch([], new Set());
    expect(plan).toEqual({ batch: [], remainingAfterBatch: 0, jobDone: true });
  });
});
