export async function inspectExistingEmployeeAuthLink(client, authUserId) {
  const { data, error } = await client
    .from('ops_employee_auth_identities')
    .select('employee_id, state')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (error) return { status: 'unavailable' };
  if (
    !data ||
    data.state !== 'active' ||
    typeof data.employee_id !== 'string' ||
    !data.employee_id.trim()
  ) {
    return { status: 'unlinked' };
  }
  return { status: 'linked' };
}

export async function provisionLegacyOfficeWithRetry(client, args) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await client.rpc('provision_legacy_office_employee', args);
    const row = Array.isArray(data) ? data[0] : data;
    if (!error && row?.employee_id) return { status: 'provisioned' };
  }
  return { status: 'failed' };
}
