import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const isSupabaseConfiguredMock = vi.fn();
let fakeClient: SupabaseClient;
vi.mock('@/lib/supabase', async () => {
  const actual = await vi.importActual<typeof import('../../../../lib/supabase')>('../../../../lib/supabase');
  return {
    ...actual,
    isSupabaseConfigured: () => isSupabaseConfiguredMock(),
    getSupabaseServerClient: () => fakeClient,
  };
});

const isClaudeConfiguredMock = vi.fn();
vi.mock('@/lib/claude', () => ({ isClaudeConfigured: () => isClaudeConfiguredMock() }));

const getSessionEmailMock = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSessionEmail: (...args: unknown[]) => getSessionEmailMock(...args) }));

const customerOpeningMock = vi.fn();
vi.mock('@/lib/practice/customer', () => ({ customerOpening: (...args: unknown[]) => customerOpeningMock(...args) }));

const buildSessionSystemPromptMock = vi.fn();
vi.mock('@/lib/practice/context', () => ({
  buildSessionSystemPrompt: (...args: unknown[]) => buildSessionSystemPromptMock(...args),
}));

import { POST } from './route';

function request(body: unknown) {
  return new Request('http://localhost/api/practice/start', { method: 'POST', body: JSON.stringify(body) });
}

function fakeInsertingSupabase(insertResult: { data: unknown; error: unknown }) {
  const inserted: Record<string, unknown>[] = [];
  const from = vi.fn((table: string) => {
    if (table !== 'practice_sessions') throw new Error(`Unexpected table in test: ${table}`);
    return {
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return {
          select: () => ({
            single: () => Promise.resolve(insertResult),
          }),
        };
      },
    };
  });
  return { client: { from } as unknown as SupabaseClient, inserted };
}

describe('POST /api/practice/start', () => {
  beforeEach(() => {
    isSupabaseConfiguredMock.mockReset().mockReturnValue(true);
    isClaudeConfiguredMock.mockReset().mockReturnValue(true);
    getSessionEmailMock.mockReset().mockResolvedValue('rep@yulelovelights.com');
    customerOpeningMock.mockReset().mockResolvedValue('Hello?');
    buildSessionSystemPromptMock.mockReset().mockResolvedValue('system prompt');
  });

  it('degrades when Supabase is not configured', async () => {
    isSupabaseConfiguredMock.mockReturnValue(false);
    const res = await POST(request({ vertical_slug: 'holiday', emotional_state: 'excited' }));
    const json = await res.json();
    expect(json).toEqual({ configured: false, saved: false, reason: 'Supabase not configured.' });
  });

  it('degrades when Claude is not configured, without touching the database', async () => {
    isClaudeConfiguredMock.mockReturnValue(false);
    const res = await POST(request({ vertical_slug: 'holiday', emotional_state: 'excited' }));
    const json = await res.json();
    expect(json.configured).toBe(true);
    expect(json.saved).toBe(false);
    expect(customerOpeningMock).not.toHaveBeenCalled();
  });

  it('rejects a missing vertical_slug with 400', async () => {
    const res = await POST(request({ emotional_state: 'excited' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/vertical_slug/);
  });

  it('rejects an emotional_state outside the four allowed values with 400', async () => {
    const res = await POST(request({ vertical_slug: 'holiday', emotional_state: 'furious' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/emotional_state/);
  });

  it('creates a session with the AI customer opening as turn one', async () => {
    const { client, inserted } = fakeInsertingSupabase({ data: { id: 'sess-1' }, error: null });
    fakeClient = client;

    const res = await POST(request({ vertical_slug: 'holiday', emotional_state: 'guarded', objective: 'price is too high' }));
    const json = await res.json();

    expect(json).toEqual({ configured: true, saved: true, id: 'sess-1', opening: 'Hello?' });
    expect(inserted).toHaveLength(1);
    expect(inserted[0].rep_email).toBe('rep@yulelovelights.com');
    expect(inserted[0].vertical_slug).toBe('holiday');
    expect(inserted[0].emotional_state).toBe('guarded');
    expect(inserted[0].objective).toBe('price is too high');
    expect(inserted[0].turns).toEqual([{ speaker: 'customer', text: 'Hello?', at: expect.any(String) }]);
  });

  it('degrades with a friendly reason when the practice_sessions table is missing', async () => {
    const { client } = fakeInsertingSupabase({ data: null, error: { code: 'PGRST205', message: 'missing' } });
    fakeClient = client;

    const res = await POST(request({ vertical_slug: 'holiday', emotional_state: 'busy' }));
    const json = await res.json();

    expect(json.saved).toBe(false);
    expect(json.migrated).toBe(false);
    expect(json.reason).toMatch(/migration 0016/);
  });
});
