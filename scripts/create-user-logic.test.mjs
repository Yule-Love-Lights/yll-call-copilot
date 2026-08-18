import { describe, expect, it, vi } from 'vitest';
import {
  inspectExistingEmployeeAuthLink,
  provisionLegacyOfficeWithRetry,
} from './create-user-logic.mjs';

function linkClient(result) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
  };
  return { from: vi.fn(() => query), query };
}

describe('legacy Office provisioning safety helpers', () => {
  it('accepts only an existing active employee/Auth link', async () => {
    const client = linkClient({
      data: { employee_id: 'employee-1', state: 'active' },
      error: null,
    });

    await expect(inspectExistingEmployeeAuthLink(client, 'auth-1')).resolves.toEqual({
      status: 'linked',
    });
    expect(client.from).toHaveBeenCalledWith('ops_employee_auth_identities');
    expect(client.query.eq).toHaveBeenCalledWith('auth_user_id', 'auth-1');
  });

  it.each([
    { data: null, error: null },
    { data: { employee_id: 'employee-1', state: 'revoked' }, error: null },
    { data: { employee_id: '', state: 'active' }, error: null },
  ])('rejects an unknown, revoked, or malformed existing Auth user', async result => {
    const client = linkClient(result);
    await expect(inspectExistingEmployeeAuthLink(client, 'auth-1')).resolves.toEqual({
      status: 'unlinked',
    });
  });

  it('fails closed when existing-link verification is unavailable', async () => {
    const client = linkClient({ data: null, error: { message: 'provider detail' } });
    await expect(inspectExistingEmployeeAuthLink(client, 'auth-1')).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('retries the same idempotent provisioning call once after an uncertain failure', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'timeout' } })
      .mockResolvedValueOnce({ data: [{ employee_id: 'employee-1' }], error: null });

    await expect(
      provisionLegacyOfficeWithRetry({ rpc }, { p_auth_user_id: 'auth-1' }),
    ).resolves.toEqual({ status: 'provisioned' });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'provision_legacy_office_employee',
      { p_auth_user_id: 'auth-1' },
    );
  });

  it('returns a generic failure after two unsuccessful exact attempts', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'secret detail' } }));
    await expect(
      provisionLegacyOfficeWithRetry({ rpc }, { p_auth_user_id: 'auth-1' }),
    ).resolves.toEqual({ status: 'failed' });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
