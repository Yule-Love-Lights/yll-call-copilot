import { describe, expect, it } from 'vitest';
import twilio from 'twilio';
import {
  authorizeMediaStreamUpgrade,
  consumeDurableMediaStreamGrant,
  isAllowedBridgeAppBaseUrl,
  mediaStreamStartMatches,
  postLiveSegment,
} from './live-bridge-auth.mjs';

const AUTH_TOKEN = 'twilio-auth-token';
const BASE_URL = 'wss://bridge.example.com/media';
const SESSION_ID = '123e4567-e89b-12d3-a456-426614174000';
const SOURCE_SEGMENT_ID = '223e4567-e89b-12d3-a456-426614174000';
const STREAM_GRANT = 'a'.repeat(43);
const REQUEST_PATH = `/media/streams/${SESSION_ID}/${STREAM_GRANT}`;
const PUBLIC_URL = `wss://bridge.example.com${REQUEST_PATH}`;

function authorize(overrides = {}) {
  const signature = twilio.getExpectedTwilioSignature(AUTH_TOKEN, PUBLIC_URL, {});
  return authorizeMediaStreamUpgrade({
    requestUrl: REQUEST_PATH,
    signature,
    publicBridgeUrl: BASE_URL,
    authToken: AUTH_TOKEN,
    ...overrides,
  });
}

describe('live bridge WebSocket upgrade authentication', () => {
  it('accepts a correctly signed, session-bound Twilio upgrade', () => {
    expect(authorize()).toEqual({
      ok: true,
      publicUrl: PUBLIC_URL,
      sessionId: SESSION_ID,
      streamGrant: STREAM_GRANT,
    });
  });

  it('fails closed on missing or forged signatures', () => {
    expect(authorize({ signature: undefined })).toMatchObject({ ok: false });
    expect(authorize({ signature: 'forged' })).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('rejects path, session, or query tampering before opening a socket', () => {
    expect(authorize({ requestUrl: `${REQUEST_PATH}?sessionId=other` })).toMatchObject({ ok: false });
    expect(authorize({ requestUrl: `/media/streams/other/${STREAM_GRANT}` })).toMatchObject({ ok: false });
    expect(authorize({ requestUrl: `/other/streams/${SESSION_ID}/${STREAM_GRANT}` })).toMatchObject({ ok: false });
  });

  it('binds Twilio\'s first start event to the session in the signed path', () => {
    const matching = { event: 'start', start: { customParameters: { sessionId: SESSION_ID } } };
    expect(mediaStreamStartMatches(matching, SESSION_ID, false)).toBe(true);
    expect(mediaStreamStartMatches(matching, SESSION_ID, true)).toBe(false);
    expect(mediaStreamStartMatches(matching, 'another-session', false)).toBe(false);
    expect(mediaStreamStartMatches({ event: 'media' }, SESSION_ID, false)).toBe(false);
  });

  it('requires the Hub to durably consume the stream grant before accepting the socket', async () => {
    const fetchImpl = async (_url, options) => {
      expect(options.redirect).toBe('error');
      expect(options.headers['x-live-bridge-secret']).toBe('bridge-secret-at-least-16');
      expect(JSON.parse(options.body)).toEqual({ sessionId: SESSION_ID, streamGrant: STREAM_GRANT });
      return { ok: true, status: 200 };
    };
    await expect(consumeDurableMediaStreamGrant({
      appBaseUrl: 'https://ops.example.com',
      bridgeSecret: 'bridge-secret-at-least-16',
      sessionId: SESSION_ID,
      streamGrant: STREAM_GRANT,
      fetchImpl,
      signal: undefined,
    })).resolves.toBe('authorized');
  });

  it('fails closed when durable consumption reports replay or is unavailable', async () => {
    const input = {
      appBaseUrl: 'https://ops.example.com',
      bridgeSecret: 'bridge-secret-at-least-16',
      sessionId: SESSION_ID,
      streamGrant: STREAM_GRANT,
      signal: undefined,
    };
    await expect(consumeDurableMediaStreamGrant({
      ...input,
      fetchImpl: async () => ({ ok: false, status: 403 }),
    })).resolves.toBe('denied');
    await expect(consumeDurableMediaStreamGrant({
      ...input,
      fetchImpl: async () => { throw new Error('offline'); },
    })).resolves.toBe('unavailable');
  });

  it('allows HTTPS and loopback HTTP but never sends the bridge secret over remote plaintext HTTP', async () => {
    expect(isAllowedBridgeAppBaseUrl('https://ops.example.com')).toBe(true);
    expect(isAllowedBridgeAppBaseUrl('http://localhost:3000')).toBe(true);
    expect(isAllowedBridgeAppBaseUrl('http://127.0.0.1:3000')).toBe(true);
    expect(isAllowedBridgeAppBaseUrl('http://ops.example.com')).toBe(false);

    let called = false;
    await expect(consumeDurableMediaStreamGrant({
      appBaseUrl: 'http://ops.example.com',
      bridgeSecret: 'bridge-secret-at-least-16',
      sessionId: SESSION_ID,
      streamGrant: STREAM_GRANT,
      fetchImpl: async () => {
        called = true;
        return { ok: true, status: 200 };
      },
    })).resolves.toBe('unavailable');
    expect(called).toBe(false);
  });

  it('never follows redirects when sending bridge credentials or transcript text', async () => {
    const fetchImpl = async (url, options) => {
      expect(url.toString()).toBe('https://ops.example.com/api/live/segment');
      expect(options.redirect).toBe('error');
      expect(options.headers['x-live-bridge-secret']).toBe('bridge-secret-at-least-16');
      expect(JSON.parse(options.body)).toMatchObject({
        sessionId: SESSION_ID,
        sourceSegmentId: SOURCE_SEGMENT_ID,
        speaker: 'customer',
        text: 'private transcript',
        atMs: 2500,
      });
      return { ok: false, status: 302 };
    };

    await expect(postLiveSegment({
      appBaseUrl: 'https://ops.example.com',
      bridgeSecret: 'bridge-secret-at-least-16',
      sessionId: SESSION_ID,
      sourceSegmentId: SOURCE_SEGMENT_ID,
      speaker: 'customer',
      text: 'private transcript',
      atMs: 2500,
      silenceMs: 1000,
      fetchImpl,
      signal: undefined,
    })).resolves.toBe('denied');
  });
});
