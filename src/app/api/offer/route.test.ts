// Coverage for the POST /api/offer role gate (the LOW finding this closes:
// any signed-in rep could publish a new offer version). getSessionEmail and
// resolveStaffRole are mocked so no live Supabase call is needed; the
// underlying validate/save logic is already covered in store.test.ts.

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

function postRequest(body: unknown) {
  return new Request('http://localhost/api/offer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/offer role gate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    isSupabaseConfigured.mockReturnValue(true);
    getSupabaseServerClient.mockReturnValue({} as unknown as SupabaseClient);
    getSessionEmail.mockResolvedValue('rep@example.com');
  });

  it('returns 403 for a rep and never reaches saveOfferEdit', async () => {
    resolveStaffRole.mockResolvedValue('rep');

    const res = await POST(postRequest(DEFAULT_OFFER_CONTENT));

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.saved).toBe(false);
    expect(json.reason).toBe('Offer editing is for the coach.');
    expect(saveOfferEdit).not.toHaveBeenCalled();
  });

  it('allows a non-rep (owner) role through to save', async () => {
    resolveStaffRole.mockResolvedValue('owner');
    saveOfferEdit.mockResolvedValue({ ok: true, version: 5 });

    const res = await POST(postRequest(DEFAULT_OFFER_CONTENT));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.saved).toBe(true);
    expect(json.version).toBe(5);
    expect(saveOfferEdit).toHaveBeenCalledTimes(1);
  });
});
