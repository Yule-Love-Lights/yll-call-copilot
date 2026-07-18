// Coverage for DELETE /api/brain/insights/[id] -- the missing-table degrade
// and a normal delete, following the fakeSupabase()-by-table convention
// used elsewhere in this app's route tests (e.g.
// coach/calls/[id]/route.test.ts).

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

let fakeClient: SupabaseClient;
let fromMock: ReturnType<typeof vi.fn>;
vi.mock('@/lib/supabase', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supabase')>('@/lib/supabase');
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    getSupabaseServerClient: () => fakeClient,
  };
});

import { DELETE } from './route';

function fakeSupabase(error: unknown) {
  fromMock = vi.fn((table: string) => {
    if (table !== 'brain_insights') throw new Error(`Unexpected table in test: ${table}`);
    return { delete: () => ({ eq: () => Promise.resolve({ error }) }) };
  });
  return { from: fromMock } as unknown as SupabaseClient;
}

function fakeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('DELETE /api/brain/insights/[id]', () => {
  it('degrades on a missing table', async () => {
    fakeClient = fakeSupabase({ code: 'PGRST205' });

    const res = await DELETE(new Request('http://localhost/api/brain/insights/i1'), fakeParams('i1'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.deleted).toBe(false);
    expect(json.reason).toBe('Run migration 0015 first.');
  });

  it('deletes normally', async () => {
    fakeClient = fakeSupabase(null);

    const res = await DELETE(new Request('http://localhost/api/brain/insights/i1'), fakeParams('i1'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.deleted).toBe(true);
    expect(fromMock).toHaveBeenCalledWith('brain_insights');
  });

  it('500s on an unexpected error', async () => {
    fakeClient = fakeSupabase({ code: 'OTHER' });

    const res = await DELETE(new Request('http://localhost/api/brain/insights/i1'), fakeParams('i1'));

    expect(res.status).toBe(500);
  });
});
