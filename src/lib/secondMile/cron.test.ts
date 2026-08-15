// Coverage for runSecondMileCron's idempotency guarantee: given the exact
// same GHL/transcript inputs, a second run must create zero new rows and
// must not re-scan an already-scanned transcript (which would double-bill
// the Claude call). Mocks GHL/Claude the same way queue.test.ts mocks the
// GHL client -- the fake Supabase enforces the dedupe_key unique constraint
// itself (upsert ignoreDuplicates), the same guarantee the real DB gives in
// production.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const getInstalledWonContactsMock = vi.fn();
vi.mock('./installedContacts', () => ({
  getInstalledWonContacts: (...args: unknown[]) => getInstalledWonContactsMock(...args),
}));

const scanPersonalTouchesMock = vi.fn();
vi.mock('./personalTouches', () => ({
  scanPersonalTouches: (...args: unknown[]) => scanPersonalTouchesMock(...args),
}));

import { runSecondMileCron } from './cron';

type Row = Record<string, unknown>;

function awaitableWithSelect(result: { data: Row[]; error: null }) {
  const promise = Promise.resolve(result) as Promise<typeof result> & { select?: () => Promise<typeof result> };
  promise.select = () => Promise.resolve(result);
  return promise;
}

function fakeSupabase(transcripts: Row[]) {
  const touchesStore = new Map<string, Row>();
  const scannedStore = new Set<string>();

  const from = vi.fn((table: string) => {
    if (table === 'transcripts') {
      const filters: [string, unknown][] = [];
      const builder = {
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return builder;
        },
        gte: () => ({
          order: () => Promise.resolve({
            data: transcripts.filter(row => filters.every(([column, value]) => row[column] === value)),
            error: null,
          }),
        }),
      };
      return {
        select: () => builder,
      };
    }
    if (table === 'second_mile_scans') {
      return {
        select: () => Promise.resolve({ data: [...scannedStore].map(id => ({ transcript_id: id })), error: null }),
        upsert: (row: { transcript_id: string }) => {
          scannedStore.add(row.transcript_id);
          return Promise.resolve({ error: null });
        },
      };
    }
    if (table === 'second_mile_touches') {
      return {
        upsert: (rows: Row[]) => {
          const inserted: Row[] = [];
          for (const row of rows) {
            const key = row.dedupe_key as string;
            if (!touchesStore.has(key)) {
              touchesStore.set(key, row);
              inserted.push(row);
            }
          }
          return awaitableWithSelect({ data: inserted, error: null });
        },
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return { client: { from } as unknown as SupabaseClient, touchesStore, scannedStore };
}

const TRANSCRIPTS: Row[] = [
  { id: 't1', raw_text: 'call 1 transcript text', customer_name: 'Jordan', ghl_contact_id: 'c1', created_at: new Date().toISOString(), metric_scope: 'performance' },
  { id: 't2', raw_text: 'call 2 transcript text', customer_name: 'Sam', ghl_contact_id: 'c2', created_at: new Date().toISOString(), metric_scope: 'performance' },
];

const WON_CONTACTS = [{ ghlContactId: 'c_won', customerName: 'Alex Chen', address: '5 Pine Rd' }];

describe('runSecondMileCron', () => {
  beforeEach(() => {
    getInstalledWonContactsMock.mockReset().mockResolvedValue({ contacts: WON_CONTACTS, source: 'ghl_won_opportunity' });
    scanPersonalTouchesMock.mockReset().mockResolvedValue([{ detail: "kid's name is Max", category: 'family', quote: 'our son Max' }]);
  });

  it('outside the December window: scans transcripts, creates reveal_photo but no cookies_ornament', async () => {
    const { client } = fakeSupabase(TRANSCRIPTS);
    const now = new Date('2026-07-14T17:00:00Z'); // mid-July, outside Dec 10-25

    const result = await runSecondMileCron(client, now);

    expect(result.transcriptsScanned).toBe(2);
    expect(result.personalTouchesCreated).toBe(2); // one touch per transcript, distinct dedupe keys
    expect(result.cookiesOrnamentWindowActive).toBe(false);
    expect(result.cookiesOrnamentCreated).toBe(0);
    expect(result.revealPhotoCreated).toBe(1);
    expect(result.installedContactsSource).toBe('ghl_won_opportunity');
  });

  it('inside the December window: creates both cookies_ornament and reveal_photo', async () => {
    const { client } = fakeSupabase(TRANSCRIPTS);
    const now = new Date('2026-12-15T17:00:00Z'); // inside Dec 10-25

    const result = await runSecondMileCron(client, now);

    expect(result.cookiesOrnamentWindowActive).toBe(true);
    expect(result.cookiesOrnamentCreated).toBe(1);
    expect(result.revealPhotoCreated).toBe(1);
  });

  it('does not scan a training transcript into customer second-mile actions', async () => {
    const { client } = fakeSupabase([
      ...TRANSCRIPTS,
      { id: 'simulator', raw_text: 'scripted practice', customer_name: 'Practice Customer', ghl_contact_id: null, created_at: new Date().toISOString(), metric_scope: 'training' },
    ]);

    const result = await runSecondMileCron(client, new Date('2026-07-14T17:00:00Z'));

    expect(result.transcriptsScanned).toBe(2);
    expect(scanPersonalTouchesMock).toHaveBeenCalledTimes(2);
  });

  it('idempotency: a second run given the same inputs creates zero new rows and re-scans nothing', async () => {
    const { client, touchesStore, scannedStore } = fakeSupabase(TRANSCRIPTS);
    const now = new Date('2026-12-15T17:00:00Z');

    const first = await runSecondMileCron(client, now);
    expect(first.transcriptsScanned).toBe(2);
    expect(touchesStore.size).toBeGreaterThan(0);
    expect(scannedStore.size).toBe(2);
    const rowCountAfterFirst = touchesStore.size;

    scanPersonalTouchesMock.mockClear();
    const second = await runSecondMileCron(client, now);

    expect(second.transcriptsScanned).toBe(0); // both transcripts already in second_mile_scans
    expect(scanPersonalTouchesMock).not.toHaveBeenCalled(); // never re-billed for an already-scanned transcript
    expect(second.personalTouchesCreated).toBe(0);
    expect(second.cookiesOrnamentCreated).toBe(0);
    expect(second.revealPhotoCreated).toBe(0);
    expect(touchesStore.size).toBe(rowCountAfterFirst); // no new rows at all
  });
});
