// Coverage for the Twilio voice helpers -- all of it exercisable without a
// live account: env-gating (the important case, since no Twilio account
// exists yet), the exact TwiML XML shape (deterministic string building, no
// network), and signature verification (real HMAC round-trip via the
// `twilio` package's own getExpectedTwilioSignature, not a live call).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import twilio from 'twilio';
import { buildVoiceAccessToken, buildVoiceTwiml, isTwilioConfigured, verifyTwilioSignature } from './twilioVoice';

const TWILIO_ENV_KEYS = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_API_KEY_SID',
  'TWILIO_API_KEY_SECRET',
  'TWILIO_TWIML_APP_SID',
  'TWILIO_CALLER_ID',
  'TWILIO_AUTH_TOKEN',
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
    process.env.TWILIO_ACCOUNT_SID = 'ACxxx';
    process.env.TWILIO_API_KEY_SID = 'SKxxx';
    process.env.TWILIO_API_KEY_SECRET = 'secret';
    process.env.TWILIO_TWIML_APP_SID = 'APxxx';
    process.env.TWILIO_CALLER_ID = '+15551234567';
    expect(isTwilioConfigured()).toBe(true);
  });
});

describe('buildVoiceAccessToken', () => {
  it('returns {configured:false} when Twilio env is absent', () => {
    expect(buildVoiceAccessToken('rep@example.com')).toEqual({ configured: false });
  });

  it('returns a real, well-shaped JWT once configured', () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACxxx';
    process.env.TWILIO_API_KEY_SID = 'SKxxx';
    process.env.TWILIO_API_KEY_SECRET = 'secret';
    process.env.TWILIO_TWIML_APP_SID = 'APxxx';
    process.env.TWILIO_CALLER_ID = '+15551234567';

    const result = buildVoiceAccessToken('rep@example.com');
    expect(result.configured).toBe(true);
    if (!result.configured) throw new Error('unreachable');
    expect(result.identity).toBe('rep@example.com');
    // A JWT is three base64url segments separated by dots.
    expect(result.token.split('.')).toHaveLength(3);
  });
});

describe('buildVoiceTwiml', () => {
  it('builds the exact expected TwiML: consent Say, both_tracks Stream with the sessionId parameter, then Dial', () => {
    process.env.TWILIO_CALLER_ID = '+15551234567';

    const xml = buildVoiceTwiml({ toNumber: '+15557654321', streamUrl: 'wss://bridge.example.com:8787', sessionId: 'sess_123' });

    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>This call may be recorded.</Say><Start><Stream url="wss://bridge.example.com:8787" track="both_tracks"><Parameter name="sessionId" value="sess_123"/></Stream></Start><Dial callerId="+15551234567"><Number>+15557654321</Number></Dial></Response>',
    );
  });

  it('falls back to an empty callerId rather than throwing when TWILIO_CALLER_ID is unset', () => {
    const xml = buildVoiceTwiml({ toNumber: '+15557654321', streamUrl: 'wss://bridge.example.com:8787', sessionId: 'sess_123' });
    expect(xml).toContain('<Dial callerId="">');
  });
});

describe('verifyTwilioSignature', () => {
  it('passes everything through when TWILIO_AUTH_TOKEN is unset (no live account to validate against yet)', () => {
    expect(verifyTwilioSignature({ url: 'https://example.com/api/twilio/voice', params: {}, signature: null })).toBe(true);
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
