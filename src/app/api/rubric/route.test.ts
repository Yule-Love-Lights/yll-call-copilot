// Coverage for the MED auth finding: POST /api/rubric had no role check, so
// any signed-in rep could redefine the team's own scoring standard. GET
// stays open to all staff (unchanged, no test needed here). Mocks
// session/role resolution and saveRubricEdit directly, same style as
// src/app/api/scores/route.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const getSessionEmailMock = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  getSessionEmail: (...args: unknown[]) => getSessionEmailMock(...args),
}));

const resolveStaffRoleMock = vi.fn();
vi.mock('@/lib/auth/role', () => ({
  resolveStaffRole: (...args: unknown[]) => resolveStaffRoleMock(...args),
}));

const saveRubricEditMock = vi.fn();
vi.mock('@/lib/scoring/rubric', () => ({
  getActiveRubric: vi.fn(),
  saveRubricEdit: (...args: unknown[]) => saveRubricEditMock(...args),
}));

vi.mock('@/lib/supabase', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/supabase')>('../../../lib/supabase');
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    getSupabaseServerClient: () => ({}) as unknown as SupabaseClient,
  };
});

import { POST } from './route';

function postRequest(body: unknown) {
  return new Request('http://localhost/api/rubric', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/rubric — role gate (fix 8)', () => {
  beforeEach(() => {
    getSessionEmailMock.mockReset();
    resolveStaffRoleMock.mockReset();
    saveRubricEditMock.mockReset();
  });

  it('rejects a rep with 403, never touching saveRubricEdit', async () => {
    getSessionEmailMock.mockResolvedValue('rep@yulelovelights.com');
    resolveStaffRoleMock.mockResolvedValue('rep');

    const res = await POST(postRequest({ some: 'rubric' }));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.saved).toBe(false);
    expect(saveRubricEditMock).not.toHaveBeenCalled();
  });

  it('allows an owner to save', async () => {
    getSessionEmailMock.mockResolvedValue('boss@yulelovelights.com');
    resolveStaffRoleMock.mockResolvedValue('owner');
    saveRubricEditMock.mockResolvedValue({ ok: true, version: 4 });

    const res = await POST(postRequest({ some: 'rubric' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ configured: true, saved: true, version: 4 });
    expect(saveRubricEditMock).toHaveBeenCalledTimes(1);
  });

  it('allows an admin to save', async () => {
    getSessionEmailMock.mockResolvedValue('admin@yulelovelights.com');
    resolveStaffRoleMock.mockResolvedValue('admin');
    saveRubricEditMock.mockResolvedValue({ ok: true, version: 5 });

    const res = await POST(postRequest({ some: 'rubric' }));

    expect(res.status).toBe(200);
    expect(saveRubricEditMock).toHaveBeenCalledTimes(1);
  });
});
