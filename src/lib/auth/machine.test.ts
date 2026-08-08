import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  verifyBearerRequest,
  verifyCronRequest,
  verifyHeaderSecret,
  verifyValueSecret,
} from './machine';

describe('machine request authentication', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('accepts the exact Vercel Cron bearer secret', () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret-at-least-16');
    const request = new Request('https://ops.example.com/api/cron/job', {
      headers: { authorization: 'Bearer cron-secret-at-least-16' },
    });
    expect(verifyCronRequest(request)).toBe('authorized');
  });

  it('fails closed when a secret is absent, blank, short, or padded', () => {
    const request = new Request('https://ops.example.com/api/cron/job', {
      headers: { authorization: 'Bearer supplied-secret-value' },
    });
    expect(verifyBearerRequest(request, undefined)).toBe('unconfigured');
    expect(verifyBearerRequest(request, '')).toBe('unconfigured');
    expect(verifyBearerRequest(request, 'too-short')).toBe('unconfigured');
    expect(verifyBearerRequest(request, ' padded-secret-value ')).toBe('unconfigured');
  });

  it('rejects missing, malformed, and incorrect bearer credentials', () => {
    const secret = 'correct-secret-value';
    expect(
      verifyBearerRequest(new Request('https://ops.example.com/api/cron/job'), secret),
    ).toBe('denied');
    expect(
      verifyBearerRequest(
        new Request('https://ops.example.com/api/cron/job', {
          headers: { authorization: 'Basic correct-secret-value' },
        }),
        secret,
      ),
    ).toBe('denied');
    expect(
      verifyBearerRequest(
        new Request('https://ops.example.com/api/cron/job', {
          headers: { authorization: 'Bearer incorrect-secret' },
        }),
        secret,
      ),
    ).toBe('denied');
  });

  it('applies the same closed decision model to header and legacy value secrets', () => {
    const secret = 'shared-secret-value';
    const request = new Request('https://ops.example.com/api/machine', {
      headers: { 'x-service-secret': secret },
    });
    expect(verifyHeaderSecret(request, 'x-service-secret', secret)).toBe('authorized');
    expect(verifyHeaderSecret(request, 'x-service-secret', 'different-secret-value')).toBe(
      'denied',
    );
    expect(verifyValueSecret(secret, secret)).toBe('authorized');
    expect(verifyValueSecret('wrong-secret-value', secret)).toBe('denied');
  });
});
