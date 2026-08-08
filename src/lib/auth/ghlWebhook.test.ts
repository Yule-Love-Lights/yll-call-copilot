import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authenticateGhlWebhook,
  buildGhlWebhookEventKey,
  verifyGhlWebhookSignature,
} from './ghlWebhook';

describe('HighLevel webhook authentication', () => {
  it('builds a stable, namespaced replay key over the exact raw bytes', () => {
    expect(buildGhlWebhookEventKey('{"a":1}')).toBe(buildGhlWebhookEventKey('{"a":1}'));
    expect(buildGhlWebhookEventKey('{"a":1}')).not.toBe(buildGhlWebhookEventKey('{ "a": 1 }'));
    expect(buildGhlWebhookEventKey('{"a":1}')).toMatch(/^ghl:sha256:[a-f0-9]{64}$/);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('verifies an Ed25519 signature against the exact raw body', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const body = JSON.stringify({ type: 'InboundMessage', id: 'event-1' });
    const signature = sign(null, Buffer.from(body), privateKey).toString('base64');
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    expect(verifyGhlWebhookSignature(body, signature, publicPem)).toBe(true);
    expect(verifyGhlWebhookSignature(`${body} `, signature, publicPem)).toBe(false);
    expect(verifyGhlWebhookSignature(body, 'not-base64', publicPem)).toBe(false);
  });

  it('does not downgrade an invalid signature to the legacy shared secret', () => {
    vi.stubEnv('GHL_WEBHOOK_SECRET', 'legacy-secret-at-least-16');
    const request = new Request('https://ops.example.com/api/webhooks/ghl?key=legacy-secret-at-least-16', {
      method: 'POST',
      headers: { 'x-ghl-signature': 'invalid-signature' },
    });
    expect(authenticateGhlWebhook(request, '{}')).toBe('denied');
  });

  it('supports a constant-time legacy header or query secret during migration', () => {
    vi.stubEnv('GHL_WEBHOOK_SECRET', 'legacy-secret-at-least-16');
    const headerRequest = new Request('https://ops.example.com/api/webhooks/ghl', {
      method: 'POST',
      headers: { 'x-ghl-webhook-secret': 'legacy-secret-at-least-16' },
    });
    expect(authenticateGhlWebhook(headerRequest, '{}')).toBe('authorized');

    const queryRequest = new Request(
      'https://ops.example.com/api/webhooks/ghl?key=legacy-secret-at-least-16',
      { method: 'POST' },
    );
    expect(authenticateGhlWebhook(queryRequest, '{}')).toBe('authorized');
  });

  it('fails closed when neither signed delivery nor a usable fallback is configured', () => {
    const request = new Request('https://ops.example.com/api/webhooks/ghl', { method: 'POST' });
    expect(authenticateGhlWebhook(request, '{}')).toBe('unconfigured');

    vi.stubEnv('GHL_WEBHOOK_SECRET', 'short');
    expect(authenticateGhlWebhook(request, '{}')).toBe('unconfigured');
  });
});
