import { describe, expect, it, vi } from 'vitest';
import { buildLegacyActor, type AppUserRole } from './capabilities';
import {
  authorizeActiveClaimedLead,
  authorizeLeadDetailRead,
  type LeadWorkRow,
} from './leadWork';

function actor(role: AppUserRole = 'rep', email = 'rep@example.com') {
  const result = buildLegacyActor({
    authUserId: `auth-${role}`,
    employeeId: `employee-${role}`,
    email,
    appUserRole: role,
  });
  if (!result) throw new Error(`expected actor for ${role}`);
  return result;
}

function lead(overrides: Partial<LeadWorkRow> = {}): LeadWorkRow {
  return {
    id: 'lead-1',
    status: 'claimed',
    claimed_by: 'rep@example.com',
    claimed_employee_id: 'employee-rep',
    ...overrides,
  };
}

function database(auditError: unknown = null) {
  const insert = vi.fn(async () => ({ error: auditError }));
  return {
    client: { from: vi.fn(() => ({ insert })) },
    insert,
  };
}

describe('lead work authorization', () => {
  it('allows attributed work only on an active self-claim', () => {
    const rep = actor();
    expect(authorizeActiveClaimedLead(rep, lead())).toEqual({ status: 'authorized' });
    expect(authorizeActiveClaimedLead(rep, lead({ status: 'done' }))).toEqual({ status: 'denied' });
    expect(authorizeActiveClaimedLead(rep, lead({ status: 'queued', claimed_by: null }))).toEqual({ status: 'denied' });
    expect(authorizeActiveClaimedLead(rep, lead({ claimed_by: 'other@example.com' }))).toEqual({ status: 'denied' });
    expect(authorizeActiveClaimedLead(rep, lead({ claimed_employee_id: 'employee-other' }))).toEqual({ status: 'denied' });
  });

  it('lets a rep read and manage followups only for their own claimed/done lead', async () => {
    const db = database();
    const rep = actor();

    await expect(authorizeLeadDetailRead(db.client as never, { actor: rep, lead: lead() })).resolves.toEqual({
      status: 'authorized', access: 'self', canWork: true, canManageFollowups: true,
    });
    await expect(authorizeLeadDetailRead(db.client as never, {
      actor: rep,
      lead: lead({ status: 'done' }),
    })).resolves.toEqual({
      status: 'authorized', access: 'self', canWork: false, canManageFollowups: true,
    });
    await expect(authorizeLeadDetailRead(db.client as never, {
      actor: rep,
      lead: lead({ claimed_by: 'other@example.com' }),
    })).resolves.toEqual({ status: 'denied' });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('allows an Owner/Admin foreign read only after a durable audit and keeps it read-only', async () => {
    const db = database();
    const admin = actor('admin', 'admin@example.com');

    await expect(authorizeLeadDetailRead(db.client as never, {
      actor: admin,
      lead: lead({ claimed_by: 'rep@example.com' }),
    })).resolves.toEqual({
      status: 'authorized', access: 'team', canWork: false, canManageFollowups: false,
    });
    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'authorization_lead_detail_override',
      detail: expect.objectContaining({
        actingEmployeeId: 'employee-admin',
        resourceId: 'lead-1',
        ownerEmployeeId: 'employee-rep',
        ownerEmail: 'rep@example.com',
      }),
    }));
  });

  it('fails closed when an Owner/Admin foreign-read audit cannot be stored', async () => {
    const db = database({ message: 'unavailable' });
    const admin = actor('owner', 'owner@example.com');
    await expect(authorizeLeadDetailRead(db.client as never, {
      actor: admin,
      lead: lead({ status: 'queued', claimed_by: null }),
    })).resolves.toEqual({ status: 'unavailable' });
  });
});
