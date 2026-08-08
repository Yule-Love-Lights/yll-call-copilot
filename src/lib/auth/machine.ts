import { createHash, timingSafeEqual } from 'node:crypto';

export type MachineAuthDecision = 'authorized' | 'denied' | 'unconfigured';

const MINIMUM_SECRET_LENGTH = 16;

export function verifyCronRequest(request: Request): MachineAuthDecision {
  return verifyBearerRequest(request, process.env.CRON_SECRET);
}

export function verifyBearerRequest(
  request: Request,
  configuredSecret: string | undefined,
): MachineAuthDecision {
  const secret = usableSecret(configuredSecret);
  if (!secret) return 'unconfigured';

  const authorization = request.headers.get('authorization');
  const prefix = 'Bearer ';
  if (!authorization?.startsWith(prefix)) return 'denied';
  return safeSecretEqual(authorization.slice(prefix.length), secret)
    ? 'authorized'
    : 'denied';
}

export function verifyHeaderSecret(
  request: Request,
  headerName: string,
  configuredSecret: string | undefined,
): MachineAuthDecision {
  const secret = usableSecret(configuredSecret);
  if (!secret) return 'unconfigured';
  const provided = request.headers.get(headerName);
  if (!provided) return 'denied';
  return safeSecretEqual(provided, secret) ? 'authorized' : 'denied';
}

export function verifyValueSecret(
  provided: string | null,
  configuredSecret: string | undefined,
): MachineAuthDecision {
  const secret = usableSecret(configuredSecret);
  if (!secret) return 'unconfigured';
  if (!provided) return 'denied';
  return safeSecretEqual(provided, secret) ? 'authorized' : 'denied';
}

function usableSecret(value: string | undefined): string | null {
  if (!value || value !== value.trim() || value.length < MINIMUM_SECRET_LENGTH) {
    return null;
  }
  return value;
}

function safeSecretEqual(provided: string, expected: string): boolean {
  const providedDigest = createHash('sha256').update(provided).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
