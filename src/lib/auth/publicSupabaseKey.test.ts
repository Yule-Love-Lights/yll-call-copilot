import { describe, expect, it } from 'vitest';
import { isBrowserSafeSupabaseKey } from './publicSupabaseKey';

function legacyKey(role: string) {
  const payload = btoa(JSON.stringify({ role }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
}

describe('isBrowserSafeSupabaseKey', () => {
  it('accepts publishable and legacy anon browser keys only', () => {
    expect(isBrowserSafeSupabaseKey('sb_publishable_1234567890abcdefghij')).toBe(true);
    expect(isBrowserSafeSupabaseKey(legacyKey('anon'))).toBe(true);
  });

  it('rejects server, malformed, and other-role keys', () => {
    expect(isBrowserSafeSupabaseKey('sb_secret_1234567890abcdefghij')).toBe(false);
    expect(isBrowserSafeSupabaseKey(legacyKey('service_role'))).toBe(false);
    expect(isBrowserSafeSupabaseKey('not-a-key')).toBe(false);
    expect(isBrowserSafeSupabaseKey('')).toBe(false);
  });
});
