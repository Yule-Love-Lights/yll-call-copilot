// Coverage for buildQueue() — focused on the H1 regression: the
// quote-follow-up source (an opportunity's embedded `contact` ref) must
// hydrate dnd/tags via getContact() before scoring isCallable, not score a
// hardcoded dnd:undefined/tags:[]. Mocks the GHL client and Supabase the
// same way followups.test.ts/brainReview.test.ts mock their dependencies.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const getStageNameMapMock = vi.fn();
const getOpenOpportunitiesMock = vi.fn();
const listContactsMock = vi.fn();
const getContactMock = vi.fn();

vi.mock('../ghl/client', () => ({
  isHighLevelConfigured: () => true,
  getStageNameMap: (...args: unknown[]) => getStageNameMapMock(...args),
  getOpenOpportunities: (...args: unknown[]) => getOpenOpportunitiesMock(...args),
  listContacts: (...args: unknown[]) => listContactsMock(...args),
  getContact: (...args: unknown[]) => getContactMock(...args),
}));

// Real delay() would add a real 150ms wait per hydrated candidate — no need
// to actually pace a test suite against nothing.
vi.mock('../transcripts/ingest', () => ({
  delay: () => Promise.resolve(),
  GHL_RATE_LIMIT_GAP_MS: 150,
}));

let fakeClient: SupabaseClient;
vi.mock('../supabase', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseServerClient: () => fakeClient,
}));

import { buildQueue } from './queue';

type FakeSupabase = { client: SupabaseClient; insertedLeads: Record<string, unknown>[]; loggedEvents: Record<string, unknown>[] };

function fakeSupabase(existingRows: { id: string; ghl_contact_id: string; status: string }[] = []): FakeSupabase {
  const insertedLeads: Record<string, unknown>[] = [];
  const loggedEvents: Record<string, unknown>[] = [];

  const from = vi.fn((table: string) => {
    if (table === 'leads') {
      return {
        select: () => ({
          in: () => Promise.resolve({ data: existingRows, error: null }),
        }),
        insert: (row: Record<string, unknown>) => {
          insertedLeads.push(row);
          return Promise.resolve({ error: null });
        },
      };
    }
    if (table === 'events_log') {
      return {
        insert: (row: Record<string, unknown>) => {
          loggedEvents.push(row);
          return Promise.resolve({ error: null });
        },
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return { client: { from } as unknown as SupabaseClient, insertedLeads, loggedEvents };
}

function quoteOpportunity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'opp1',
    contactId: 'c1',
    pipelineId: 'p1',
    pipelineStageId: 'stage1',
    status: 'open',
    updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    contact: { id: 'c1', name: 'Jordan Rivera', email: 'jordan@example.com', phone: '555-0100' },
    ...overrides,
  };
}

describe('buildQueue — quote-follow-up DNC hydration (H1)', () => {
  beforeEach(() => {
    getStageNameMapMock.mockReset().mockResolvedValue(new Map([['stage1', 'Bid Sent']]));
    getOpenOpportunitiesMock.mockReset().mockResolvedValue([]);
    listContactsMock.mockReset().mockResolvedValue([]);
    getContactMock.mockReset();
  });

  it('excludes a dnd-flagged contact even though the opportunity embeds a contact ref (no hardcoded dnd:undefined)', async () => {
    getOpenOpportunitiesMock.mockResolvedValue([quoteOpportunity()]);
    getContactMock.mockResolvedValue({
      id: 'c1',
      source: 'highlevel',
      fullName: 'Jordan Rivera',
      email: 'jordan@example.com',
      phone: '555-0100',
      dnd: true,
      tags: [],
    });

    const { client, insertedLeads } = fakeSupabase();
    fakeClient = client;

    const result = await buildQueue();

    expect(getContactMock).toHaveBeenCalledWith('c1');
    expect(insertedLeads.find(r => r.ghl_contact_id === 'c1')).toBeUndefined();
    expect(result.added).toBe(0);
  });

  it('excludes a contact tagged DNC even though the opportunity embeds a contact ref', async () => {
    getOpenOpportunitiesMock.mockResolvedValue([quoteOpportunity()]);
    getContactMock.mockResolvedValue({
      id: 'c1',
      source: 'highlevel',
      fullName: 'Jordan Rivera',
      dnd: false,
      tags: ['DNC'],
    });

    const { client, insertedLeads } = fakeSupabase();
    fakeClient = client;

    await buildQueue();

    expect(insertedLeads.find(r => r.ghl_contact_id === 'c1')).toBeUndefined();
  });

  it('queues a callable contact via the quote-follow-up source once hydrated', async () => {
    getOpenOpportunitiesMock.mockResolvedValue([quoteOpportunity()]);
    getContactMock.mockResolvedValue({
      id: 'c1',
      source: 'highlevel',
      fullName: 'Jordan Rivera',
      email: 'jordan@example.com',
      phone: '555-0100',
      dnd: false,
      tags: [],
    });

    const { client, insertedLeads } = fakeSupabase();
    fakeClient = client;

    const result = await buildQueue();

    const inserted = insertedLeads.find(r => r.ghl_contact_id === 'c1');
    expect(inserted).toBeDefined();
    expect(inserted?.source).toBe('quote_followup');
    expect(result.added).toBe(1);
  });

  it('fails closed (excludes, does not queue) and logs to events_log when hydration itself fails', async () => {
    getOpenOpportunitiesMock.mockResolvedValue([quoteOpportunity()]);
    getContactMock.mockRejectedValue(new Error('HighLevel 500'));

    const { client, insertedLeads, loggedEvents } = fakeSupabase();
    fakeClient = client;

    await buildQueue();

    expect(insertedLeads.find(r => r.ghl_contact_id === 'c1')).toBeUndefined();
    expect(loggedEvents.some(e => e.kind === 'queue_dnc_hydration_failed')).toBe(true);
  });
});
