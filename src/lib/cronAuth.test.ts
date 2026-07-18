// Coverage for the cron-route bearer-secret check. Style follows
// auth/allowlist.test.ts.

import { describe, it, expect, afterEach } from 'vitest';
import { isCronRequestAuthorized } from './cronAuth';

describe('isCronRequestAuthorized', () => {
  const savedSecret = process.env.CRON_SECRET;

  afterEach(() => {
    if (savedSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = savedSecret;
  });

  it('allows any request when CRON_SECRET is unset', () => {
    delete process.env.CRON_SECRET;
    const request = new Request('https://example.com/api/cron/brain-review');
    expect(isCronRequestAuthorized(request)).toBe(true);
  });

  it('allows any request when CRON_SECRET is empty', () => {
    process.env.CRON_SECRET = '';
    const request = new Request('https://example.com/api/cron/brain-review');
    expect(isCronRequestAuthorized(request)).toBe(true);
  });

  it('allows a request with the correct bearer header once CRON_SECRET is set', () => {
    process.env.CRON_SECRET = 'topsecret';
    const request = new Request('https://example.com/api/cron/brain-review', {
      headers: { Authorization: 'Bearer topsecret' },
    });
    expect(isCronRequestAuthorized(request)).toBe(true);
  });

  it('denies a request with the wrong bearer header once CRON_SECRET is set', () => {
    process.env.CRON_SECRET = 'topsecret';
    const request = new Request('https://example.com/api/cron/brain-review', {
      headers: { Authorization: 'Bearer wrong' },
    });
    expect(isCronRequestAuthorized(request)).toBe(false);
  });

  it('denies a request with no bearer header once CRON_SECRET is set', () => {
    process.env.CRON_SECRET = 'topsecret';
    const request = new Request('https://example.com/api/cron/brain-review');
    expect(isCronRequestAuthorized(request)).toBe(false);
  });
});
