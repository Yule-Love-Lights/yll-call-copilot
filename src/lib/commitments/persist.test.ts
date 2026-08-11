// Coverage for persistCommitments -- the DEDUPE KEY's idempotency
// (#217 DONE criterion 2: re-extracting the SAME transcript is a no-op, not
// a duplicate insert) and that a re-extraction never clobbers a
// status/dismissed_reason a later slice's verify job already set.

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { persistCommitments } from './persist';
import type { CommitmentRow } from './types';

type UpsertCall = { rows: Record<string, unknown>[]; options?: Record<string, unknown> };

function fakeSupabase() {
  const upsertCalls: UpsertCall[] = [];
  const upsert = vi.fn((rows: Record<string, unknown>[], options?: Record<string, unknown>) => {
    upsertCalls.push({ rows, options });
    return Promise.resolve({ error: null });
  });
  const from = vi.fn((table: string) => {
    if (table === 'call_commitments') return { upsert };
    throw new Error(`Unexpected table in test: ${table}`);
  });
  return { client: { from } as unknown as SupabaseClient, upsertCalls };
}

const oneRow: CommitmentRow[] = [{ kind: 'send_quote', detail: 'send the quote today', promised_at: null, extraction_index: 0 }];

describe('persistCommitments', () => {
  it('upserts on the (transcript_id, kind, extraction_index) dedupe key, not a bare insert', async () => {
    const { client, upsertCalls } = fakeSupabase();

    await persistCommitments(client, 't1', 'rep@yulelovelights.com', 'ghl-1', oneRow);

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

  it('calling it twice for the same transcript sends the same dedupe-key columns both times (idempotent upsert, no duplicate row)', async () => {
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

    await expect(persistCommitments(client, 't1', null, null, [])).resolves.toBeUndefined();

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
    const client = { from: () => ({ upsert }) } as unknown as SupabaseClient;

    await expect(persistCommitments(client, 't1', null, null, oneRow)).rejects.toBeTruthy();
  });
});
