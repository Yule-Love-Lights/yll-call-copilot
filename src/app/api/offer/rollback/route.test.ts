// Coverage for the POST /api/offer/rollback role gate -- same LOW finding
// as route.test.ts one level up: rollback re-publishes a new offer version,
// so it needs the identical non-rep gate.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const isSupabaseConfigured = vi.fn();
const getSupabaseServerClient = vi.fn();
vi.mock('@/lib/supabase', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/supabase')>();
  return {
    ...actual,
    isSupabaseConfigured: () => isSupabaseConfigured(),
    getSupabaseServerClient: () => getSupabaseServerClient(),
  };
});

const getSessionEmail = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  getSessionEmail: () => getSessionEmail(),
}));

const resolveStaffRole = vi.fn();
vi.mock('@/lib/auth/role', () => ({
  resolveStaffRole: (client: unknown, email: unknown) => resolveStaffRole(client, email),
}));

const saveOfferEdit = vi.fn();
vi.mock('@/lib/offer/store', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/offer/store')>();
  return {
    ...actual,
    saveOfferEdit: (client: unknown, content: unknown) => saveOfferEdit(client, content),
  };
});

import { POST } from './route';
import { DEFAULT_OFFER_CONTENT } from '@/lib/offer/store';

// A client whose offer_versions.select().eq().maybeSingle() returns a
// stored version's content -- only reached once the role gate passes.
function fakeClient() {
  const maybeSingle = vi.fn(async () => ({ data: { content: DEFAULT_OFFER_CONTENT }, error: null }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from } as unknown as SupabaseClient;
}

function rollbackRequest(version: number) {
  return new Request('http://localhost/api/offer/rollback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version }),
  });
}

describe('POST /api/offer/rollback role gate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    isSupabaseConfigured.mockReturnValue(true);
    getSessionEmail.mockResolvedValue('rep@example.com');
  });

  it('returns 403 for a rep and never reaches saveOfferEdit', async () => {
    getSupabaseServerClient.mockReturnValue(fakeClient());
    resolveStaffRole.mockResolvedValue('rep');

    const res = await POST(rollbackRequest(1));

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.saved).toBe(false);
    expect(json.reason).toBe('Offer editing is for the coach.');
    expect(saveOfferEdit).not.toHaveBeenCalled();
  });

  it('allows a non-rep (admin) role through to roll back', async () => {
    getSupabaseServerClient.mockReturnValue(fakeClient());
    resolveStaffRole.mockResolvedValue('admin');
    saveOfferEdit.mockResolvedValue({ ok: true, version: 6 });

    const res = await POST(rollbackRequest(1));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.saved).toBe(true);
    expect(json.version).toBe(6);
    expect(saveOfferEdit).toHaveBeenCalledTimes(1);
  });
});
