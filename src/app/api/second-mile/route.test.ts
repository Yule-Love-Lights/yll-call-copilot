import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseServerClient: vi.fn(),
  transcriptIds: [] as string[],
  transcriptScope: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseServerClient: mocks.getSupabaseServerClient,
  isSupabaseConfigured: vi.fn(() => true),
  isMissingTableError: vi.fn(() => false),
}));

vi.mock('@/lib/secondMile/decemberWindow', () => ({
  isWithinCookiesOrnamentWindow: vi.fn(() => false),
}));

import { GET } from './route';

const PERFORMANCE_TRANSCRIPT = '90000000-0000-0000-0000-000000000001';
const PENDING_TRANSCRIPT = '90000000-0000-0000-0000-000000000002';
const MISSING_TRANSCRIPT = '90000000-0000-0000-0000-000000000003';

function touch(
  id: string,
  kind: 'personal_touch' | 'reveal_photo',
  transcriptId?: string,
) {
  return {
    id,
    ghl_contact_id: `contact-${id}`,
    customer_name: `Customer ${id}`,
    kind,
    status: 'pending',
    due_at: null,
    payload: transcriptId === undefined
      ? { detail: 'no source id' }
      : { transcript_id: transcriptId, detail: 'remembered detail' },
    dedupe_key: `dedupe-${id}`,
    created_at: '2026-08-13T12:00:00.000Z',
    done_at: null,
    done_by: null,
  };
}

function database(options?: { provenanceError?: boolean }) {
  const touches = [
    touch('ordinary', 'reveal_photo'),
    touch('performance', 'personal_touch', PERFORMANCE_TRANSCRIPT),
    touch('pending', 'personal_touch', PENDING_TRANSCRIPT),
    touch('missing', 'personal_touch', MISSING_TRANSCRIPT),
    touch('malformed', 'personal_touch', 'not-a-uuid'),
    touch('no-id', 'personal_touch'),
  ];

  const from = vi.fn((table: string) => {
    if (table === 'second_mile_touches') {
      return {
        select: () => ({
          order: () => ({
            limit: async () => ({ data: touches, error: null }),
          }),
        }),
      };
    }

    if (table === 'transcripts') {
      const query = {
        in: (_column: string, ids: string[]) => {
          mocks.transcriptIds = ids;
          return query;
        },
        eq: async (_column: string, scope: string) => {
          mocks.transcriptScope = scope;
          return options?.provenanceError
            ? { data: null, error: { message: 'provenance lookup failed' } }
            : { data: [{ id: PERFORMANCE_TRANSCRIPT }], error: null };
        },
      };
      return { select: () => query };
    }

    throw new Error(`unexpected table ${table}`);
  });

  return { from };
}

describe('GET /api/second-mile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transcriptIds = [];
    mocks.transcriptScope = null;
  });

  it('returns personal touches only when their source transcript is currently performance-scoped', async () => {
    mocks.getSupabaseServerClient.mockReturnValue(database());

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.touches.map((row: { id: string }) => row.id)).toEqual([
      'ordinary',
      'performance',
    ]);
    expect(mocks.transcriptIds).toEqual([
      PERFORMANCE_TRANSCRIPT,
      PENDING_TRANSCRIPT,
      MISSING_TRANSCRIPT,
    ]);
    expect(mocks.transcriptScope).toBe('performance');
  });

  it('fails closed when transcript provenance cannot be verified', async () => {
    mocks.getSupabaseServerClient.mockReturnValue(database({ provenanceError: true }));

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.touches).toEqual([]);
  });
});
