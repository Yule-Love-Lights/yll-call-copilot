import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('./create-user.mjs', import.meta.url));
const fixtureEmail = 'field.employee@example.test';
const fixturePassword = 'not-a-real-password';

function run(role) {
  return spawnSync(process.execPath, [script, fixtureEmail, fixturePassword, role], {
    encoding: 'utf8',
    env: process.env,
  });
}

describe('legacy Office user provisioning', () => {
  it.each(['advertising', 'installer', 'manager', 'owner', 'admin', 'unknown'])(
    'rejects the %s role before contacting Supabase',
    role => {
      const result = run(role);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('creates Office bootstrap users only');
      expect(`${result.stdout}${result.stderr}`).not.toContain(fixtureEmail);
      expect(`${result.stdout}${result.stderr}`).not.toContain(fixturePassword);
    },
  );

  it('uses the guarded identity RPC instead of writing app_users directly', () => {
    const source = readFileSync(script, 'utf8');

    expect(source).toContain('provisionLegacyOfficeWithRetry');
    expect(source).toContain("p_reason: 'legacy_office_bootstrap'");
    expect(source).not.toContain('p_role:');
    expect(source).not.toContain(".from('app_users')");
    expect(source).not.toContain('console.log(`Auth user ${email}');
    expect(source).toContain('inspectExistingEmployeeAuthLink');
    expect(source).toContain('Naldo or Jason must review');
    expect(source).not.toContain('admin.auth.admin.deleteUser');
  });
});
