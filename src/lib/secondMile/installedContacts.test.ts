import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('../ghl/client', () => ({
  getContact: vi.fn(),
  isHighLevelConfigured: () => false,
}));

vi.mock('../ghl/secondMile', () => ({
  getWonOpportunities: vi.fn(),
}));

import { getInstalledWonContacts } from './installedContacts';

describe('installed-contact transcript fallback provenance', () => {
  it('uses only booked performance transcripts', async () => {
    const eqCalls: [string, unknown][] = [];
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        eqCalls.push([column, value]);
        return builder;
      },
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({
          data: [{ ghl_contact_id: 'contact-1', customer_name: 'Jamie', called_at: '2026-07-01T12:00:00Z', created_at: '2026-07-01T12:00:00Z' }],
          error: null,
        }).then(resolve),
    };
    const client = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

    const result = await getInstalledWonContacts(client, 2026);

    expect(result.source).toBe('transcript_fallback');
    expect(result.contacts).toHaveLength(1);
    expect(eqCalls).toEqual([
      ['metric_scope', 'performance'],
      ['outcome', 'booked'],
    ]);
  });
});
