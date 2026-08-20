import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildHubActor } from './capabilities';
import {
  auditTeamResourceAccess,
  authorizeCallResource,
  decideOwnedResourceAccess,
} from './resource';

function actor(role: 'rep' | 'owner' | 'admin') {
  const value = buildHubActor({
    authUserId: `auth-${role}`,
    employeeId: `employee-${role}`,
    compatibilityEmail: `${role}@example.com`,
    employeeRole: role === 'rep' ? 'office' : role,
    memberships: ['office'],
    membershipVersion: 1,
  });
  if (!value) throw new Error('expected actor');
  return value;
}

describe('resource authorization', () => {
  it('allows self, denies another employee, and requires an explicit team capability', () => {
    expect(decideOwnedResourceAccess(actor('rep'), 'REP@example.com')).toBe('self');
    expect(decideOwnedResourceAccess(actor('rep'), 'other@example.com')).toBe('denied');
    expect(decideOwnedResourceAccess(actor('owner'), 'other@example.com')).toBe('team');
  });

  it('fails a team access audit closed when the durable insert fails', async () => {
    const insert = vi.fn(async () => ({ error: { message: 'down' } }));
    const from = vi.fn(() => ({ insert }));
    const client = { from } as unknown as SupabaseClient;

    expect(await auditTeamResourceAccess(client, {
      actor: actor('owner'),
      action: 'read',
      resourceType: 'live_session',
      resourceId: 'session-1',
      ownerEmail: 'rep@example.com',
    })).toBe(false);
    expect(from).toHaveBeenCalledWith('events_log');
  });

  it('binds a call resource to its owner and audits an explicit admin override', async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { rep_email: 'rep@example.com', rep_employee_id: 'employee-rep' },
      error: null,
    }));
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const insert = vi.fn(async () => ({ error: null }));
    const from = vi.fn((table: string) => table === 'calls' ? { select } : { insert });
    const client = { from } as unknown as SupabaseClient;

    expect(await authorizeCallResource(client, {
      actor: actor('rep'), callId: 'call-1', action: 'call.read',
      resourceType: 'call', resourceId: 'call-1', teamCapability: 'operations.admin',
    })).toMatchObject({ status: 'authorized', access: 'self' });

    expect(await authorizeCallResource(client, {
      actor: actor('owner'), callId: 'call-1', action: 'call.read',
      resourceType: 'call', resourceId: 'call-1', teamCapability: 'operations.admin',
    })).toMatchObject({ status: 'authorized', access: 'team' });
    expect(insert).toHaveBeenCalledOnce();
  });

  it('denies a matching compatibility email when the immutable employee owner differs', async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { rep_email: 'rep@example.com', rep_employee_id: 'employee-other' },
      error: null,
    }));
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const insert = vi.fn(async () => ({ error: null }));
    const from = vi.fn((table: string) => table === 'calls' ? { select } : { insert });
    const client = { from } as unknown as SupabaseClient;

    expect(await authorizeCallResource(client, {
      actor: actor('rep'), callId: 'call-1', action: 'call.read',
      resourceType: 'call', resourceId: 'call-1', teamCapability: 'operations.admin',
    })).toEqual({ status: 'denied' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('gives Admin the same audited team-read semantics as Owner', async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { rep_email: 'rep@example.com', rep_employee_id: 'employee-rep' },
      error: null,
    }));
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const insert = vi.fn(async () => ({ error: null }));
    const from = vi.fn((table: string) => table === 'calls' ? { select } : { insert });
    const client = { from } as unknown as SupabaseClient;

    expect(await authorizeCallResource(client, {
      actor: actor('admin'), callId: 'call-1', action: 'call.read',
      resourceType: 'call', resourceId: 'call-1', teamCapability: 'operations.admin',
    })).toMatchObject({ status: 'authorized', access: 'team' });
    expect(insert).toHaveBeenCalledOnce();
  });
});
