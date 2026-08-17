// Coverage for persistCommitments -- the DEDUPE KEY's idempotency
// (#217 DONE criterion 2: re-extracting the SAME transcript is a no-op, not
// a duplicate insert), and the #217 review chain:
//
//   HIGH: the position-based dedupe key combined with status-omission can
//   mislabel a RESOLVED row on a reordered re-extraction unless the
//   re-extraction is refused once any row for the transcript is no longer
//   'open'.
//
//   MEDIUM (TOCTOU): a two-round-trip check-then-write (a SELECT, then a
//   separate UPSERT) leaves a gap for a concurrent status change to land
//   between them, reproducing the mislabeling bug the HIGH fix was meant
//   to prevent. Closed by moving the check-and-write into ONE database
//   function (call_commitments_upsert_batch, supabase/migrations/
//   0022_call_commitments_upsert_fn.sql) invoked through a single RPC call.
//
// This suite cannot exercise real concurrent transactions against a mocked
// client -- there is no live Postgres here to race two sessions against.
// What it verifies instead is the CONTRACT that makes the race
// unreachable from the application side: persistCommitments now performs
// exactly one round trip (a single supabase.rpc(...) call, never a
// separate .from('call_commitments').select()/.upsert() pair), so there is
// no longer a gap in application code for a status change to land in.
// Whether the RPC body is itself atomic is a property of the SQL in
// 0021 (the `for update` lock), not something a mocked-client unit test
// can prove -- that's a live-database/integration-test claim, out of scope
// for this suite.

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { persistCommitments } from './persist';
import type { CommitmentRow } from './types';

type RpcCall = { fn: string; args: Record<string, unknown> };

function fakeSupabase(rpcResult: 'ok' | 'refused' = 'ok') {
  const rpcCalls: RpcCall[] = [];
  const fromCalls: string[] = [];
  const rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    return Promise.resolve({ data: rpcResult, error: null });
  });
  const from = vi.fn((table: string) => {
    fromCalls.push(table);
    throw new Error(`Unexpected .from('${table}') call in test -- persistCommitments must go through rpc() only.`);
  });
  return { client: { rpc, from } as unknown as SupabaseClient, rpcCalls, fromCalls };
}

const oneRow: CommitmentRow[] = [{ kind: 'send_quote', detail: 'send the quote today', promised_at: null, extraction_index: 0 }];

describe('persistCommitments', () => {
  it('writes through a single RPC call to call_commitments_upsert_batch, never a separate select/upsert pair', async () => {
    const { client, rpcCalls, fromCalls } = fakeSupabase('ok');

    const result = await persistCommitments(client, 't1', 'rep@yulelovelights.com', 'ghl-1', oneRow);

    expect(result).toEqual({ ok: true });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('call_commitments_upsert_batch');
    expect(fromCalls).toHaveLength(0); // proves no two-round-trip gap exists in application code
  });

  it('passes the transcript id and dedupe-key columns (kind, extraction_index) in the RPC payload', async () => {
    const { client, rpcCalls } = fakeSupabase('ok');
    const twoRows: CommitmentRow[] = [
      { kind: 'send_photos', detail: 'front roofline photos', promised_at: null, extraction_index: 0 },
      { kind: 'send_photos', detail: 'shed photos', promised_at: null, extraction_index: 1 },
    ];

    await persistCommitments(client, 't1', null, null, twoRows);

    expect(rpcCalls[0].args.p_transcript_id).toBe('t1');
    const rows = rpcCalls[0].args.p_rows as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: 'send_photos', extraction_index: 0, detail: 'front roofline photos' });
    expect(rows[1]).toMatchObject({ kind: 'send_photos', extraction_index: 1, detail: 'shed photos' });
  });

  it('calling it twice for the same transcript sends the same dedupe-key columns both times (idempotent, no duplicate row)', async () => {
    const { client, rpcCalls } = fakeSupabase('ok');

    await persistCommitments(client, 't1', null, null, oneRow);
    await persistCommitments(client, 't1', null, null, oneRow);

    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls[0].args).toEqual(rpcCalls[1].args);
  });

  it('does nothing for zero commitments (no error, no RPC call)', async () => {
    const { client, rpcCalls } = fakeSupabase('ok');

    await expect(persistCommitments(client, 't1', null, null, [])).resolves.toEqual({ ok: true });

    expect(rpcCalls).toHaveLength(0);
  });

  it('never includes status in the RPC payload, so a re-extraction cannot reopen a commitment the verify job already cleared/dismissed', async () => {
    const { client, rpcCalls } = fakeSupabase('ok');

    await persistCommitments(client, 't1', null, null, oneRow);

    const row = (rpcCalls[0].args.p_rows as Record<string, unknown>[])[0];
    expect(row).not.toHaveProperty('status');
    expect(row).not.toHaveProperty('dismissed_reason');
    expect(row).not.toHaveProperty('cleared_at');
  });

  it('throws when the RPC errors, instead of swallowing it', async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: null, error: { message: 'boom' } }));
    const client = { rpc, from: vi.fn() } as unknown as SupabaseClient;

    await expect(persistCommitments(client, 't1', null, null, oneRow)).rejects.toBeTruthy();
  });

  // The rejection path itself -- when the RPC's atomic locked check finds a
  // resolved row (whether the transcript already had one, or a concurrent
  // transaction resolved one during this function's SELECT ... FOR UPDATE),
  // it returns 'refused' and this function must surface that without
  // having performed any partial write. This exercises persistCommitments'
  // side of the contract; the atomicity itself lives in the SQL (0021),
  // not here.
  it('surfaces a refusal when the RPC reports the transcript has a resolved commitment, without a second call', async () => {
    const { client, rpcCalls } = fakeSupabase('refused');

    const result = await persistCommitments(client, 't1', null, null, oneRow);

    expect(result).toEqual({ ok: false, reason: 'has_resolved_commitments' });
    expect(rpcCalls).toHaveLength(1); // one shot -- no separate write attempted after a refusal
  });
});
