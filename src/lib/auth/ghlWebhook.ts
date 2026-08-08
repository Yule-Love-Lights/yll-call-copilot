import { createHash, verify } from 'node:crypto';
import { verifyValueSecret, type MachineAuthDecision } from './machine';

// Current HighLevel Ed25519 webhook public key, published in HighLevel's
// official webhook integration guide. The signature covers the exact raw body.
export const GHL_ED25519_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;

export function authenticateGhlWebhook(
  request: Request,
  rawBody: string,
): MachineAuthDecision {
  const signature = request.headers.get('x-ghl-signature');
  if (signature) {
    return verifyGhlWebhookSignature(rawBody, signature) ? 'authorized' : 'denied';
  }

  // Compatibility path for the existing private workflow webhook. Prefer a
  // header; retain the old query parameter until the HighLevel workflow is
  // reconfigured. Both use a constant-time comparison and fail closed.
  const headerSecret = request.headers.get('x-ghl-webhook-secret');
  const querySecret = new URL(request.url).searchParams.get('key');
  return verifyValueSecret(headerSecret ?? querySecret, process.env.GHL_WEBHOOK_SECRET);
}

export function verifyGhlWebhookSignature(
  rawBody: string,
  signature: string,
  publicKey = GHL_ED25519_PUBLIC_KEY,
): boolean {
  if (!signature || signature === 'N/A') return false;
  try {
    return verify(
      null,
      Buffer.from(rawBody, 'utf8'),
      publicKey,
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}

export function buildGhlWebhookEventKey(rawBody: string): string {
  return `ghl:sha256:${createHash('sha256').update(rawBody, 'utf8').digest('hex')}`;
}
