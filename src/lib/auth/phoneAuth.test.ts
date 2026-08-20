import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  HUB_SESSION_MAX_AGE_MS,
  OTP_RESEND_COOLDOWN_MS,
  isHubSessionWithinMaximumAge,
  isVerifiedPhoneOtpSession,
  normalizeE164Phone,
  normalizeSixDigitOtp,
  otpResendSecondsRemaining,
  requestPhoneOtp,
  resolvePhoneAuthConfiguration,
  verifyPhoneOtp,
} from './phoneAuth';

function fakeClient(options: {
  requestError?: unknown;
  requestThrows?: boolean;
  verifyError?: unknown;
  verifyThrows?: boolean;
  session?: object | null;
  user?: object | null;
} = {}) {
  const signInWithOtp = vi.fn(async () => {
    if (options.requestThrows) throw new Error('network detail');
    return { data: {}, error: options.requestError ?? null };
  });
  const verifyOtp = vi.fn(async () => {
    if (options.verifyThrows) throw new Error('network detail');
    return {
      data: {
        session: options.session === undefined ? { access_token: 'redacted' } : options.session,
        user: options.user === undefined ? { id: 'auth-user' } : options.user,
      },
      error: options.verifyError ?? null,
    };
  });
  return {
    client: { auth: { signInWithOtp, verifyOtp } } as unknown as SupabaseClient,
    signInWithOtp,
    verifyOtp,
  };
}

function phoneClaims(overrides: Record<string, unknown> = {}) {
  return {
    aud: 'authenticated',
    is_anonymous: false,
    role: 'authenticated',
    session_id: '11111111-1111-4111-8111-111111111111',
    sub: 'auth-user-1',
    phone: '+16315550123',
    amr: [{ method: 'otp', timestamp: 10 }],
    ...overrides,
  };
}

describe('staging phone-auth configuration', () => {
  it('defaults off and preserves the Office password bootstrap', () => {
    expect(resolvePhoneAuthConfiguration({})).toEqual({ mode: 'disabled' });
    expect(
      resolvePhoneAuthConfiguration({ HUB_PHONE_AUTH_STAGING_ENABLED: 'false' }),
    ).toEqual({ mode: 'disabled' });
  });

  it('enables only with an exact flag and a Turnstile site key', () => {
    expect(
      resolvePhoneAuthConfiguration({
        HUB_PHONE_AUTH_STAGING_ENABLED: 'true',
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'turnstile-site-key',
        VERCEL_ENV: 'preview',
        VERCEL_GIT_COMMIT_REF: 'staging',
      }),
    ).toEqual({ mode: 'enabled', turnstileSiteKey: 'turnstile-site-key' });

    for (const environment of [
      { HUB_PHONE_AUTH_STAGING_ENABLED: 'true' },
      { HUB_PHONE_AUTH_STAGING_ENABLED: 'TRUE', NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'key', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'staging' },
      { HUB_PHONE_AUTH_STAGING_ENABLED: 'yes', NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'key', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'staging' },
      { HUB_PHONE_AUTH_STAGING_ENABLED: ' true ', NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'key', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'staging' },
      { HUB_PHONE_AUTH_STAGING_ENABLED: 'true', NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'key', VERCEL_ENV: ' preview ', VERCEL_GIT_COMMIT_REF: 'staging' },
      { HUB_PHONE_AUTH_STAGING_ENABLED: 'true', NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'key', VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'staging' },
      { HUB_PHONE_AUTH_STAGING_ENABLED: 'true', NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'key', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature-branch' },
    ]) {
      expect(resolvePhoneAuthConfiguration(environment)).toEqual({ mode: 'unavailable' });
    }
  });
});

describe('phone OTP input and provider behavior', () => {
  it('normalizes US formatting and already-international E.164 input', () => {
    expect(normalizeE164Phone('(631) 555-0123')).toBe('+16315550123');
    expect(normalizeE164Phone('1-631-555-0123')).toBe('+16315550123');
    expect(normalizeE164Phone('+44 20 7946 0958')).toBe('+442079460958');
  });

  it('rejects invalid, extended, or ambiguous phone input', () => {
    for (const value of [
      '',
      '555-0123',
      '631-555-0123 x9',
      '001-631-555-0123',
      '+0123456789',
      '1+6315550123',
      '++16315550123',
    ]) {
      expect(normalizeE164Phone(value)).toBeNull();
    }
  });

  it('accepts exactly six numeric OTP digits', () => {
    expect(normalizeSixDigitOtp(' 123456 ')).toBe('123456');
    for (const value of ['12345', '1234567', '12 3456', 'abcdef']) {
      expect(normalizeSixDigitOtp(value)).toBeNull();
    }
  });

  it('requires valid phone and a fresh Turnstile token before calling Supabase', async () => {
    const { client, signInWithOtp } = fakeClient();
    await expect(requestPhoneOtp(client, { phone: 'bad', captchaToken: 'captcha' })).resolves.toEqual({
      status: 'invalid_phone',
    });
    await expect(requestPhoneOtp(client, { phone: '6315550123', captchaToken: null })).resolves.toEqual({
      status: 'captcha_required',
    });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it('uses invite-only Supabase Phone Auth and sends Turnstile to Supabase', async () => {
    const { client, signInWithOtp } = fakeClient();
    await expect(
      requestPhoneOtp(client, { phone: '(631) 555-0123', captchaToken: 'captcha-token' }),
    ).resolves.toEqual({ status: 'submitted', phone: '+16315550123' });
    expect(signInWithOtp).toHaveBeenCalledWith({
      phone: '+16315550123',
      options: { captchaToken: 'captcha-token', shouldCreateUser: false },
    });
  });

  it.each([
    ['unknown or disabled provider', { requestError: { code: 'otp_disabled', message: 'detail' } }],
    ['rate limit', { requestError: { status: 429, message: 'detail' } }],
    ['SDK throw', { requestThrows: true }],
  ])('keeps %s request outcomes non-enumerating', async (_label, options) => {
    const { client } = fakeClient(options);
    await expect(
      requestPhoneOtp(client, { phone: '6315550123', captchaToken: 'captcha-token' }),
    ).resolves.toEqual({ status: 'submitted', phone: '+16315550123' });
  });

  it.each([
    ['expired code', { verifyError: { code: 'otp_expired', message: 'detail' } }],
    ['rate limit', { verifyError: { status: 429, message: 'detail' } }],
    ['SDK throw', { verifyThrows: true }],
    ['missing session', { session: null }],
  ])('rejects %s without exposing provider detail', async (_label, options) => {
    const { client } = fakeClient(options);
    await expect(
      verifyPhoneOtp(client, { phone: '+16315550123', code: '123456' }),
    ).resolves.toEqual({ status: 'rejected' });
  });

  it('rejects malformed codes locally and accepts a complete Supabase session', async () => {
    const { client, verifyOtp } = fakeClient();
    await expect(
      verifyPhoneOtp(client, { phone: '+16315550123', code: '123' }),
    ).resolves.toEqual({ status: 'invalid_code' });
    expect(verifyOtp).not.toHaveBeenCalled();

    await expect(
      verifyPhoneOtp(client, { phone: '+16315550123', code: '123456' }),
    ).resolves.toEqual({ status: 'signed_in' });
    expect(verifyOtp).toHaveBeenCalledWith({
      phone: '+16315550123',
      token: '123456',
      type: 'sms',
    });
  });
});

describe('phone-auth session and resend limits', () => {
  it('enforces the 60-second resend cooldown', () => {
    expect(otpResendSecondsRemaining(OTP_RESEND_COOLDOWN_MS, 0)).toBe(60);
    expect(otpResendSecondsRemaining(OTP_RESEND_COOLDOWN_MS, 59999)).toBe(1);
    expect(otpResendSecondsRemaining(OTP_RESEND_COOLDOWN_MS, 60000)).toBe(0);
  });

  it('accepts no more than 30 days from this session\'s OTP AMR timestamp', () => {
    const now = Date.parse('2026-08-18T12:00:00.000Z');
    expect(
      isHubSessionWithinMaximumAge(
        phoneClaims({ amr: [{ method: 'otp', timestamp: (now - HUB_SESSION_MAX_AGE_MS) / 1000 }] }),
        now,
      ),
    ).toBe(true);
    expect(
      isHubSessionWithinMaximumAge(
        phoneClaims({ amr: [{ method: 'otp', timestamp: (now - HUB_SESSION_MAX_AGE_MS - 1000) / 1000 }] }),
        now,
      ),
    ).toBe(false);
  });

  it('fails closed for missing, unprovable, non-OTP, or future session timestamps', () => {
    const now = Date.parse('2026-08-18T12:00:00.000Z');
    expect(isHubSessionWithinMaximumAge({}, now)).toBe(false);
    expect(isHubSessionWithinMaximumAge(phoneClaims({ amr: ['otp'] }), now)).toBe(false);
    expect(isHubSessionWithinMaximumAge(phoneClaims({ amr: [{ method: 'password', timestamp: now / 1000 }] }), now)).toBe(false);
    expect(
      isHubSessionWithinMaximumAge(
        phoneClaims({ amr: [{ method: 'otp', timestamp: now / 1000 + 1 }] }),
        now,
      ),
    ).toBe(false);
    expect(
      isHubSessionWithinMaximumAge(
        phoneClaims({ amr: [{ method: 'otp', timestamp: now / 1000 + 0.5 }] }),
        now,
      ),
    ).toBe(false);
  });

  it('accepts only a matching Supabase phone identity whose current method is OTP', () => {
    const user = { id: 'auth-user-1', phone: '+1 (631) 555-0123' };
    expect(
      isVerifiedPhoneOtpSession(
        phoneClaims(),
        user,
      ),
    ).toBe(true);
    expect(
      isVerifiedPhoneOtpSession(
        phoneClaims({ amr: ['otp'] }),
        user,
      ),
    ).toBe(true);
  });

  it('rejects password, mismatched, missing, and ambiguous authentication claims', () => {
    const user = { id: 'auth-user-1', phone: '+16315550123' };
    for (const claims of [
      phoneClaims({ amr: [{ method: 'password', timestamp: 10 }] }),
      phoneClaims({ sub: 'other-user' }),
      phoneClaims({ phone: '+16465550123' }),
      phoneClaims({ amr: ['otp', 'password'] }),
      phoneClaims({ amr: undefined }),
    ]) {
      expect(isVerifiedPhoneOtpSession(claims, user)).toBe(false);
    }
  });

  it('requires complete authenticated Supabase session claims', () => {
    const user = { id: 'auth-user-1', phone: '+16315550123' };
    for (const overrides of [
      { session_id: undefined },
      { session_id: 'not-a-uuid' },
      { role: 'anon' },
      { aud: 'anon' },
      { is_anonymous: true },
      { is_anonymous: undefined },
    ]) {
      expect(isVerifiedPhoneOtpSession(phoneClaims(overrides), user)).toBe(false);
      expect(isHubSessionWithinMaximumAge(phoneClaims(overrides), 11_000)).toBe(false);
    }
  });

  it('rejects tied or mixed timestamp authentication methods instead of trusting array order', () => {
    const user = { id: 'auth-user-1', phone: '+16315550123' };
    for (const amr of [
      [
        { method: 'otp', timestamp: 10 },
        { method: 'password', timestamp: 10 },
      ],
      [
        { method: 'password', timestamp: 10 },
        { method: 'otp', timestamp: 10 },
      ],
      [
        { method: 'otp', timestamp: 10 },
        'password',
      ],
    ]) {
      expect(isVerifiedPhoneOtpSession(phoneClaims({ amr }), user)).toBe(false);
      expect(isHubSessionWithinMaximumAge(phoneClaims({ amr }), 11_000)).toBe(false);
    }
  });

  it('uses the most recent timestamped authentication method', () => {
    const user = { id: 'auth-user-1', phone: '+16315550123' };
    expect(
      isVerifiedPhoneOtpSession(
        phoneClaims({
          amr: [
            { method: 'password', timestamp: 5 },
            { method: 'otp', timestamp: 10 },
          ],
        }),
        user,
      ),
    ).toBe(true);
    expect(
      isVerifiedPhoneOtpSession(
        phoneClaims({
          amr: [
            { method: 'otp', timestamp: 5 },
            { method: 'password', timestamp: 10 },
          ],
        }),
        user,
      ),
    ).toBe(false);
  });
});
