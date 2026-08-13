// Coverage for the Twilio voice helpers -- all of it exercisable without a
// live account: env-gating (the important case, since no Twilio account
// exists yet), the exact TwiML XML shape (deterministic string building, no
// network), and signature verification (real HMAC round-trip via the
// `twilio` package's own getExpectedTwilioSignature, not a live call).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import twilio from 'twilio';
import {
  buildLiveBridgeStreamUrl,
  buildVoiceAccessToken,
  buildVoiceTwiml,
  buildWhisperTwiml,
  CONSENT_LINE,
  createIdempotentDialGrant,
  isTwilioConfigured,
  twilioIdentityForAuthUserId,
  verifyTwilioSignature,
} from './twilioVoice';

const TWILIO_ENV_KEYS = [
  'LIVE_CUSTOMER_CALLS_ENABLED',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_API_KEY_SID',
  'TWILIO_API_KEY_SECRET',
  'TWILIO_TWIML_APP_SID',
  'TWILIO_CALLER_ID',
  'TWILIO_AUTH_TOKEN',
  'LIVE_BRIDGE_URL',
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(TWILIO_ENV_KEYS.map(k => [k, process.env[k]]));
  for (const key of TWILIO_ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of TWILIO_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('isTwilioConfigured', () => {
  it('is false with no Twilio env set', () => {
    expect(isTwilioConfigured()).toBe(false);
  });

  it('is false when only some of the required vars are set', () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACxxx';
    process.env.TWILIO_API_KEY_SID = 'SKxxx';
    expect(isTwilioConfigured()).toBe(false);
  });

  it('is true once every required var is set', () => {
    process.env.LIVE_CUSTOMER_CALLS_ENABLED = 'true';
    process.env.TWILIO_ACCOUNT_SID = 'ACxxx';
    process.env.TWILIO_API_KEY_SID = 'SKxxx';
    process.env.TWILIO_API_KEY_SECRET = 'secret';
    process.env.TWILIO_TWIML_APP_SID = 'APxxx';
    process.env.TWILIO_CALLER_ID = '+15551234567';
    process.env.TWILIO_AUTH_TOKEN = 'auth-token';
    process.env.LIVE_BRIDGE_URL = 'wss://bridge.example.com';
    expect(isTwilioConfigured()).toBe(true);
  });

  it('stays false with complete credentials until customer calling is explicitly enabled', () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACxxx';
    process.env.TWILIO_API_KEY_SID = 'SKxxx';
    process.env.TWILIO_API_KEY_SECRET = 'secret';
    process.env.TWILIO_TWIML_APP_SID = 'APxxx';
    process.env.TWILIO_CALLER_ID = '+15551234567';
    process.env.TWILIO_AUTH_TOKEN = 'auth-token';
    process.env.LIVE_BRIDGE_URL = 'wss://bridge.example.com';
    expect(isTwilioConfigured()).toBe(false);
  });
});

describe('buildLiveBridgeStreamUrl', () => {
  it('builds a unique path that binds Twilio\'s signed upgrade to one session', () => {
    const grant = 'a'.repeat(43);
    expect(buildLiveBridgeStreamUrl('wss://bridge.example.com/media', 'sess_123', grant)).toBe(
      `wss://bridge.example.com/media/streams/sess_123/${grant}`,
    );
  });

  it('rejects insecure URLs, query strings, and malformed grants', () => {
    expect(() => buildLiveBridgeStreamUrl('ws://bridge.example.com', 'sess_123', 'a'.repeat(43))).toThrow();
    expect(() => buildLiveBridgeStreamUrl('wss://bridge.example.com?key=value', 'sess_123', 'a'.repeat(43))).toThrow();
    expect(() => buildLiveBridgeStreamUrl('wss://bridge.example.com', 'sess_123', 'short')).toThrow();
  });
});

describe('createIdempotentDialGrant', () => {
  it('reproduces the exact same grant for the same actor and logical request', () => {
    process.env.TWILIO_AUTH_TOKEN = 'auth-token';
    const first = createIdempotentDialGrant('auth-user-1', 'request-1');
    const retry = createIdempotentDialGrant('auth-user-1', 'request-1');

    expect(retry).toEqual(first);
    expect(first.grant).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes the grant when either immutable id changes', () => {
    process.env.TWILIO_AUTH_TOKEN = 'auth-token';
    const baseline = createIdempotentDialGrant('auth-user-1', 'request-1');

    expect(createIdempotentDialGrant('auth-user-2', 'request-1').grant).not.toBe(baseline.grant);
    expect(createIdempotentDialGrant('auth-user-1', 'request-2').grant).not.toBe(baseline.grant);
  });

  it('fails closed without the server secret', () => {
    expect(() => createIdempotentDialGrant('auth-user-1', 'request-1')).toThrow('Twilio auth is unavailable');
  });
});

describe('buildVoiceAccessToken', () => {
  it('derives a stable Voice-safe identity from an immutable Auth user id', () => {
    const identity = twilioIdentityForAuthUserId('123e4567-e89b-12d3-a456-426614174000');
    expect(identity).toMatch(/^yll_[a-f0-9]{64}$/);
    expect(identity).toBe(twilioIdentityForAuthUserId('123e4567-e89b-12d3-a456-426614174000'));
  });
  it('returns {configured:false} when Twilio env is absent', () => {
    expect(buildVoiceAccessToken('rep@example.com')).toEqual({ configured: false });
  });

  it('returns a real, well-shaped JWT once configured', () => {
    process.env.LIVE_CUSTOMER_CALLS_ENABLED = 'true';
    process.env.TWILIO_ACCOUNT_SID = 'ACxxx';
    process.env.TWILIO_API_KEY_SID = 'SKxxx';
    process.env.TWILIO_API_KEY_SECRET = 'secret';
    process.env.TWILIO_TWIML_APP_SID = 'APxxx';
    process.env.TWILIO_CALLER_ID = '+15551234567';
    process.env.TWILIO_AUTH_TOKEN = 'auth-token';
    process.env.LIVE_BRIDGE_URL = 'wss://bridge.example.com';

    const result = buildVoiceAccessToken('rep@example.com');
    expect(result.configured).toBe(true);
    if (!result.configured) throw new Error('unreachable');
    expect(result.identity).toBe('rep@example.com');
    // A JWT is three base64url segments separated by dots.
    expect(result.token.split('.')).toHaveLength(3);
  });
});

describe('buildVoiceTwiml', () => {
  // H3 regression: this leg is the REP's browser softphone (Device.connect()
  // triggers this webhook), not the customer -- so it must never Say the
  // recording-consent line, and the Number noun must carry a whisper `url`
  // instead, which is what actually plays the notice to the CUSTOMER leg
  // once Twilio dials it and it answers (see buildWhisperTwiml below).
  it('builds the exact expected TwiML: both_tracks Stream with the sessionId parameter, then Dial with a whisper url on Number -- no Say on this (rep) leg', () => {
    process.env.TWILIO_CALLER_ID = '+15551234567';

    const xml = buildVoiceTwiml({
      toNumber: '+15557654321',
      streamUrl: 'wss://bridge.example.com:8787',
      sessionId: 'sess_123',
      whisperUrl: 'https://app.example.com/api/twilio/whisper',
    });

    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Start><Stream url="wss://bridge.example.com:8787" track="both_tracks"><Parameter name="sessionId" value="sess_123"/></Stream></Start><Dial callerId="+15551234567"><Number url="https://app.example.com/api/twilio/whisper">+15557654321</Number></Dial></Response>',
    );
  });

  it('never emits a <Say> on the rep leg', () => {
    const xml = buildVoiceTwiml({
      toNumber: '+15557654321',
      streamUrl: 'wss://bridge.example.com:8787',
      sessionId: 'sess_123',
      whisperUrl: 'https://app.example.com/api/twilio/whisper',
    });
    expect(xml).not.toContain('<Say>');
  });

  it('the Number noun carries the whisper url so Twilio requests it once the CUSTOMER leg answers', () => {
    const xml = buildVoiceTwiml({
      toNumber: '+15557654321',
      streamUrl: 'wss://bridge.example.com:8787',
      sessionId: 'sess_123',
      whisperUrl: 'https://app.example.com/api/twilio/whisper',
    });
    expect(xml).toContain('<Number url="https://app.example.com/api/twilio/whisper">+15557654321</Number>');
  });

  it('falls back to an empty callerId rather than throwing when TWILIO_CALLER_ID is unset', () => {
    const xml = buildVoiceTwiml({
      toNumber: '+15557654321',
      streamUrl: 'wss://bridge.example.com:8787',
      sessionId: 'sess_123',
      whisperUrl: 'https://app.example.com/api/twilio/whisper',
    });
    expect(xml).toContain('<Dial callerId="">');
  });
});

describe('buildWhisperTwiml', () => {
  it('plays the consent notice -- this is what the CUSTOMER leg actually hears, once answered and before being bridged in', () => {
    const xml = buildWhisperTwiml();
    expect(xml).toBe(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>${CONSENT_LINE}</Say></Response>`);
  });
});

describe('verifyTwilioSignature', () => {
  it('fails closed when TWILIO_AUTH_TOKEN is unset', () => {
    expect(verifyTwilioSignature({ url: 'https://example.com/api/twilio/voice', params: {}, signature: null })).toBe(false);
  });

  it('rejects a missing signature once TWILIO_AUTH_TOKEN is set', () => {
    process.env.TWILIO_AUTH_TOKEN = 'authtoken123';
    expect(verifyTwilioSignature({ url: 'https://example.com/api/twilio/voice', params: { To: '+15551234567' }, signature: null })).toBe(
      false,
    );
  });

  it('accepts a real, correctly computed signature', () => {
    process.env.TWILIO_AUTH_TOKEN = 'authtoken123';
    const url = 'https://example.com/api/twilio/voice';
    const params = { To: '+15551234567', sessionId: 'sess_123' };
    const signature = twilio.getExpectedTwilioSignature('authtoken123', url, params);

    expect(verifyTwilioSignature({ url, params, signature })).toBe(true);
  });

  it('rejects a signature computed for different params (tampered request)', () => {
    process.env.TWILIO_AUTH_TOKEN = 'authtoken123';
    const url = 'https://example.com/api/twilio/voice';
    const signature = twilio.getExpectedTwilioSignature('authtoken123', url, { To: '+15551234567', sessionId: 'sess_123' });

    expect(verifyTwilioSignature({ url, params: { To: '+15559999999', sessionId: 'sess_123' }, signature })).toBe(false);
  });
});
