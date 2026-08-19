import type { SupabaseClient } from '@supabase/supabase-js';

export const HUB_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const SIX_DIGIT_OTP_PATTERN = /^\d{6}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PhoneAuthEnvironment = {
  HUB_PHONE_AUTH_STAGING_ENABLED?: string;
  NEXT_PUBLIC_TURNSTILE_SITE_KEY?: string;
  VERCEL_ENV?: string;
};

export type PhoneAuthConfiguration =
  | { readonly mode: 'disabled' }
  | { readonly mode: 'enabled'; readonly turnstileSiteKey: string }
  | { readonly mode: 'unavailable' };

function readPhoneAuthEnvironment(): PhoneAuthEnvironment {
  return {
    HUB_PHONE_AUTH_STAGING_ENABLED: process.env.HUB_PHONE_AUTH_STAGING_ENABLED,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };
}

export function resolvePhoneAuthConfiguration(
  environment: PhoneAuthEnvironment = readPhoneAuthEnvironment(),
): PhoneAuthConfiguration {
  const enabled = environment.HUB_PHONE_AUTH_STAGING_ENABLED;
  if (!enabled || enabled === 'false') return { mode: 'disabled' };
  if (enabled !== 'true') return { mode: 'unavailable' };
  if (environment.VERCEL_ENV !== 'preview') return { mode: 'unavailable' };

  const turnstileSiteKey = environment.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  if (!turnstileSiteKey) return { mode: 'unavailable' };
  return { mode: 'enabled', turnstileSiteKey };
}

export function normalizeE164Phone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /[^\d+().\-\s]/.test(trimmed)) return null;
  const plusCount = [...trimmed].filter(character => character === '+').length;
  if (plusCount > 1 || (plusCount === 1 && !trimmed.startsWith('+'))) return null;

  if (trimmed.startsWith('+')) {
    const normalized = `+${trimmed.slice(1).replace(/[^\d]/g, '')}`;
    return E164_PATTERN.test(normalized) ? normalized : null;
  }

  const digits = trimmed.replace(/[^\d]/g, '');
  const normalized = digits.length === 10
    ? `+1${digits}`
    : digits.length === 11 && digits.startsWith('1')
      ? `+${digits}`
      : '';
  return E164_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeSixDigitOtp(value: string): string | null {
  const normalized = value.trim();
  return SIX_DIGIT_OTP_PATTERN.test(normalized) ? normalized : null;
}

export type RequestPhoneOtpResult =
  | { readonly status: 'invalid_phone' }
  | { readonly status: 'captcha_required' }
  | {
      // This deliberately does not expose whether Supabase accepted the
      // request. Unknown users, disabled providers, rate limits, and transient
      // provider failures all receive the same browser-visible result.
      readonly status: 'submitted';
      readonly phone: string;
    };

export async function requestPhoneOtp(
  client: SupabaseClient,
  input: { readonly phone: string; readonly captchaToken: string | null },
): Promise<RequestPhoneOtpResult> {
  const phone = normalizeE164Phone(input.phone);
  if (!phone) return { status: 'invalid_phone' };
  const captchaToken = input.captchaToken?.trim();
  if (!captchaToken) return { status: 'captcha_required' };

  try {
    await client.auth.signInWithOtp({
      phone,
      options: {
        captchaToken,
        shouldCreateUser: false,
      },
    });
  } catch {
    // Keep the request non-enumerating even when the SDK throws instead of
    // returning an AuthError.
  }
  return { status: 'submitted', phone };
}

export type VerifyPhoneOtpResult =
  | { readonly status: 'invalid_code' }
  | { readonly status: 'rejected' }
  | { readonly status: 'signed_in' };

export async function verifyPhoneOtp(
  client: SupabaseClient,
  input: { readonly phone: string; readonly code: string },
): Promise<VerifyPhoneOtpResult> {
  const phone = normalizeE164Phone(input.phone);
  const token = normalizeSixDigitOtp(input.code);
  if (!phone || !token) return { status: 'invalid_code' };

  try {
    const { data, error } = await client.auth.verifyOtp({ phone, token, type: 'sms' });
    if (error || !data.session || !data.user) return { status: 'rejected' };
    return { status: 'signed_in' };
  } catch {
    return { status: 'rejected' };
  }
}

export function otpResendSecondsRemaining(nextAllowedAt: number, now: number): number {
  return Math.max(0, Math.ceil((nextAllowedAt - now) / 1000));
}

type AuthenticationMethod = { readonly method: string; readonly timestamp: number | null };

function authenticationMethods(amr: unknown): AuthenticationMethod[] {
  if (!Array.isArray(amr)) return [];
  return amr.flatMap(entry => {
    if (typeof entry === 'string') return [{ method: entry, timestamp: null }];
    if (
      typeof entry === 'object'
      && entry !== null
      && typeof (entry as { method?: unknown }).method === 'string'
    ) {
      const timestamp = (entry as { timestamp?: unknown }).timestamp;
      return [{
        method: (entry as { method: string }).method,
        timestamp: typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : null,
      }];
    }
    return [];
  });
}

function currentAuthenticationMethod(amr: unknown): AuthenticationMethod | null {
  const methods = authenticationMethods(amr);
  if (methods.length === 0) return null;

  const timestamped = methods.filter(
    method => method.timestamp !== null,
  ) as Array<{ method: string; timestamp: number }>;
  if (timestamped.length === methods.length) {
    const latestTimestamp = Math.max(...timestamped.map(method => method.timestamp));
    const latestMethods = timestamped.filter(method => method.timestamp === latestTimestamp);

    // Supabase records AMR timestamps in whole seconds. Two different methods
    // can therefore tie. Array order is not an authentication guarantee, so a
    // tie is unprovable and must fail closed.
    return latestMethods.length === 1 ? latestMethods[0] : null;
  }

  // RFC-8176 string-form AMR has no ordering. It can prove the method only
  // when there is exactly one value, but it cannot prove session age. Mixed
  // timestamped and un-timestamped entries are ambiguous too.
  return timestamped.length === 0 && methods.length === 1 ? methods[0] : null;
}

function hasAuthenticatedSessionClaims(claims: {
  readonly aud?: unknown;
  readonly is_anonymous?: unknown;
  readonly role?: unknown;
  readonly session_id?: unknown;
}): boolean {
  const authenticatedAudience = claims.aud === 'authenticated'
    || (Array.isArray(claims.aud) && claims.aud.includes('authenticated'));
  return (
    authenticatedAudience
    && claims.role === 'authenticated'
    && claims.is_anonymous === false
    && typeof claims.session_id === 'string'
    && UUID_PATTERN.test(claims.session_id)
  );
}

export function isHubSessionWithinMaximumAge(
  claims: {
    readonly amr?: unknown;
    readonly aud?: unknown;
    readonly is_anonymous?: unknown;
    readonly role?: unknown;
    readonly session_id?: unknown;
  },
  now: number = Date.now(),
): boolean {
  if (!hasAuthenticatedSessionClaims(claims)) return false;
  const currentMethod = currentAuthenticationMethod(claims.amr);
  if (currentMethod?.method !== 'otp' || currentMethod.timestamp === null) return false;

  // Supabase AMR timestamps are Unix seconds and belong to this JWT session.
  // User.last_sign_in_at is account-wide, so another device could refresh it.
  if (!Number.isSafeInteger(currentMethod.timestamp) || currentMethod.timestamp <= 0) return false;
  const authenticatedAt = currentMethod.timestamp * 1000;
  if (!Number.isSafeInteger(authenticatedAt) || authenticatedAt > now) return false;
  return now - authenticatedAt <= HUB_SESSION_MAX_AGE_MS;
}

export function isVerifiedPhoneOtpSession(
  claims: {
    readonly aud?: unknown;
    readonly is_anonymous?: unknown;
    readonly role?: unknown;
    readonly session_id?: unknown;
    readonly sub?: unknown;
    readonly phone?: unknown;
    readonly amr?: unknown;
  },
  user: { readonly id?: unknown; readonly phone?: unknown },
): boolean {
  if (!hasAuthenticatedSessionClaims(claims)) return false;
  if (typeof claims.sub !== 'string' || claims.sub !== user.id) return false;
  if (typeof claims.phone !== 'string' || typeof user.phone !== 'string') return false;
  const claimsPhone = normalizeE164Phone(claims.phone);
  const userPhone = normalizeE164Phone(user.phone);
  if (!claimsPhone || claimsPhone !== userPhone) return false;
  return currentAuthenticationMethod(claims.amr)?.method === 'otp';
}
