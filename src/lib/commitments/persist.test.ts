// Coverage for persistCommitments -- the DEDUPE KEY's idempotency
// (#217 DONE criterion 2: re-extracting the SAME transcript is a no-op, not
// a duplicate insert), that a re-extraction never clobbers a status a later
// slice's verify job already set, and the #217 review HIGH: the
// position-based dedupe key combined with status-omission can mislabel a
// RESOLVED row on a reordered re-extraction unless the whole re-extraction
// is refused once any row for the transcript is no longer 'open'.

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { persistCommitments } from './persist';
import type { CommitmentRow } from './types';

type UpsertCall = { rows: Record<string, unknown>[]; options?: Record<string, unknown> };

function fakeSupabase(opts: { existingStatuses?: string[] } = {}) {
  const upsertCalls: UpsertCall[] = [];
  const upsert = vi.fn((rows: Record<string, unknown>[], options?: Record<string, unknown>) => {
    upsertCalls.push({ rows, options });
    return Promise.resolve({ error: null });
  });
  const select = vi.fn(() => ({
    eq: () => Promise.resolve({ data: (opts.existingStatuses ?? []).map(status => ({ status })), error: null }),
  }));
  const from = vi.fn((table: string) => {
    if (table === 'call_commitments') return { upsert, select };
    throw new Error(`Unexpected table in test: ${table}`);
  });
  return { client: { from } as unknown as SupabaseClient, upsertCalls };
}

const oneRow: CommitmentRow[] = [{ kind: 'send_quote', detail: 'send the quote today', promised_at: null, extraction_index: 0 }];

describe('persistCommitments', () => {
  it('upserts on the (transcript_id, kind, extraction_index) dedupe key, not a bare insert', async () => {
    const { client, upsertCalls } = fakeSupabase();

    const result = await persistCommitments(client, 't1', 'rep@yulelovelights.com', 'ghl-1', oneRow);

    expect(result).toEqual({ ok: true });
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].options).toEqual({ onConflict: 'transcript_id,kind,extraction_index' });
    expect(upsertCalls[0].rows[0]).toMatchObject({
      transcript_id: 't1',
      ghl_contact_id: 'ghl-1',
      rep_email: 'rep@yulelovelights.com',
      kind: 'send_quote',
      extraction_index: 0,
    });
  });

  it('calling it twice for the same transcript (still all-open) sends the same dedupe-key columns both times (idempotent upsert, no duplicate row)', async () => {
    const { client, upsertCalls } = fakeSupabase();

    await persistCommitments(client, 't1', null, null, oneRow);
    await persistCommitments(client, 't1', null, null, oneRow);

    expect(upsertCalls).toHaveLength(2);
    // Same conflict target and same key columns both times -- the second
    // call upserts onto the SAME row the first created, it does not insert
    // a second row for this transcript.
    expect(upsertCalls[0].options).toEqual(upsertCalls[1].options);
    expect(upsertCalls[0].rows[0]).toMatchObject({ transcript_id: 't1', kind: 'send_quote', extraction_index: 0 });
    expect(upsertCalls[1].rows[0]).toMatchObject({ transcript_id: 't1', kind: 'send_quote', extraction_index: 0 });
  });

  it('writes two distinct rows (index 0 and 1) for two same-kind commitments, never one collapsed row', async () => {
    const { client, upsertCalls } = fakeSupabase();
    const twoRows: CommitmentRow[] = [
      { kind: 'send_photos', detail: 'front roofline photos', promised_at: null, extraction_index: 0 },
      { kind: 'send_photos', detail: 'shed photos', promised_at: null, extraction_index: 1 },
    ];

    await persistCommitments(client, 't1', null, null, twoRows);

    expect(upsertCalls[0].rows).toHaveLength(2);
    expect(upsertCalls[0].rows[0].extraction_index).toBe(0);
    expect(upsertCalls[0].rows[1].extraction_index).toBe(1);
  });

  it('does nothing for zero commitments (no error, no upsert call)', async () => {
    const { client, upsertCalls } = fakeSupabase();

    await expect(persistCommitments(client, 't1', null, null, [])).resolves.toEqual({ ok: true });

    expect(upsertCalls).toHaveLength(0);
  });

  it('never includes status in the upsert payload, so a re-extraction cannot reopen a commitment the verify job already cleared/dismissed', async () => {
    const { client, upsertCalls } = fakeSupabase();

    await persistCommitments(client, 't1', null, null, oneRow);

    expect(upsertCalls[0].rows[0]).not.toHaveProperty('status');
    expect(upsertCalls[0].rows[0]).not.toHaveProperty('dismissed_reason');
    expect(upsertCalls[0].rows[0]).not.toHaveProperty('cleared_at');
  });

  it('throws when the upsert errors, instead of swallowing it', async () => {
    const upsert = vi.fn(() => Promise.resolve({ error: { message: 'boom' } }));
    const select = vi.fn(() => ({ eq: () => Promise.resolve({ data: [], error: null }) }));
    const client = { from: () => ({ upsert, select }) } as unknown as SupabaseClient;

    await expect(persistCommitments(client, 't1', null, null, oneRow)).rejects.toBeTruthy();
  });

  it('throws when the pre-check select errors, instead of swallowing it', async () => {
    const select = vi.fn(() => ({ eq: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }));
    const client = { from: () => ({ select, upsert: vi.fn() }) } as unknown as SupabaseClient;

    await expect(persistCommitments(client, 't1', null, null, oneRow)).rejects.toBeTruthy();
  });

  // #217 review HIGH: a forced re-extraction can return the same-kind
  // commitments in a different order than before. If one of them has
  // already been resolved (e.g. 'cleared' after the rep sent the roofline
  // photos), blindly upserting the reordered list would leave the
  // 'cleared' row describing a DIFFERENT promise than the one that was
  // actually cleared -- a settled commitment silently mislabeled against a
  // real employee's accountability record.
  it('refuses a reordered re-extraction outright when the transcript already has a resolved (non-open) commitment, rather than mislabeling it', async () => {
    // Existing state: idx0 was "roofline photos" and got cleared; idx1 was
    // "shed photos" and is still open.
    const { client, upsertCalls } = fakeSupabase({ existingStatuses: ['cleared', 'open'] });

    // The re-extraction comes back with the two promises SWAPPED: if this
    // were upserted straight through, idx0 (still marked 'cleared') would
    // now read "shed photos" -- the wrong promise -- while idx1 (still
    // 'open') would read "roofline photos", the one that was actually done.
    const reordered: CommitmentRow[] = [
      { kind: 'send_photos', detail: 'shed photos', promised_at: null, extraction_index: 0 },
      { kind: 'send_photos', detail: 'roofline photos', promised_at: null, extraction_index: 1 },
    ];

    const result = await persistCommitments(client, 't1', null, null, reordered);

    expect(result).toEqual({ ok: false, reason: 'has_resolved_commitments' });
    // Refused BEFORE any write -- the existing 'cleared' row's detail is
    // never touched, so it cannot end up mislabeled.
    expect(upsertCalls).toHaveLength(0);
  });

  it('still upserts normally when every existing row for the transcript is still open (reordering among open rows is harmless)', async () => {
    const { client, upsertCalls } = fakeSupabase({ existingStatuses: ['open', 'open'] });

    const result = await persistCommitments(client, 't1', null, null, oneRow);

    expect(result).toEqual({ ok: true });
    expect(upsertCalls).toHaveLength(1);
  });

  it('upserts normally for a transcript with no existing rows at all (first extraction)', async () => {
    const { client, upsertCalls } = fakeSupabase({ existingStatuses: [] });

    const result = await persistCommitments(client, 't1', null, null, oneRow);

    expect(result).toEqual({ ok: true });
    expect(upsertCalls).toHaveLength(1);
  });
});
