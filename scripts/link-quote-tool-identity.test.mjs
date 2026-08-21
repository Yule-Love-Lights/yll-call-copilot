import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('./link-quote-tool-identity.mjs', import.meta.url));
const fixtureEmail = 'staff.member@example.test';

describe('Quote Tool identity bridge operator script', () => {
  it('rejects invalid input without exposing the supplied identifier', () => {
    const result = spawnSync(process.execPath, [script, 'not-an-email'], {
      encoding: 'utf8',
      env: process.env,
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain('Usage:');
    expect(`${result.stdout}${result.stderr}`).not.toContain(fixtureEmail);
  });

  it('uses the guarded Hub RPC and does not create identities directly', () => {
    const source = readFileSync(script, 'utf8');

    expect(source).toContain("rpc('link_quote_tool_employee_identity'");
    expect(source).toContain("p_reason: BRIDGE_REASON");
    expect(source).toContain('isConfirmedUnbannedQuoteToolUser');
    expect(source).toContain('selectExactlyOneActiveHubEmployee');
    expect(source).not.toContain(".from('ops_employee_external_identities').insert");
    expect(source).not.toContain('console.log(`');
    expect(source).not.toContain('createUser(');
  });
});
