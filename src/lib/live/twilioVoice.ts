// Twilio voice: env-gated so the rest of the app works with zero Twilio
// account (none exists yet -- see the Phase 4 brief). Every function here
// degrades to {configured:false} rather than throwing when the envs are
// missing, same convention as isSupabaseConfigured()/isClaudeConfigured().
//
// UNTESTED against a live Twilio account. Coded against the installed
// `twilio` package's actual documented Node SDK surface (Voice access
// tokens: https://www.twilio.com/docs/iam/access-tokens, TwiML:
// https://www.twilio.com/docs/voice/twiml, Media Streams:
// https://www.twilio.com/docs/voice/media-streams, request validation:
// https://www.twilio.com/docs/usage/webhooks/webhooks-security) and verified
// offline (VoiceResponse/AccessToken need no real credentials to build XML
// or sign a JWT), but never exercised against a real call. The simulator
// (./simulator.ts) is the verified demo path; this is the parallel path for
// once the accounts exist.

import { createHash, randomBytes } from 'node:crypto';
import twilio from 'twilio';

const { AccessToken } = twilio.jwt;
const { VoiceGrant } = AccessToken;

// A dial path is configured only when it can both mint a token and validate
// Twilio's callback signature. Partial configuration must not expose an
// unchecked webhook.
export function isTwilioConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_API_KEY_SID &&
    process.env.TWILIO_API_KEY_SECRET &&
    process.env.TWILIO_TWIML_APP_SID &&
    process.env.TWILIO_CALLER_ID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.LIVE_BRIDGE_URL
  );
}

export type VoiceTokenResult = { configured: true; token: string; identity: string } | { configured: false };

// An hour is long enough for one call plus setup; the client re-fetches a
// fresh token for every "Start coached call" click, so there is no need for
// a longer-lived grant.
const TOKEN_TTL_SECONDS = 3600;

export function buildVoiceAccessToken(identity: string): VoiceTokenResult {
  if (!isTwilioConfigured()) return { configured: false };

  const token = new AccessToken(
    process.env.TWILIO_ACCOUNT_SID!,
    process.env.TWILIO_API_KEY_SID!,
    process.env.TWILIO_API_KEY_SECRET!,
    { identity, ttl: TOKEN_TTL_SECONDS },
  );
  token.addGrant(
    new VoiceGrant({ outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID!, incomingAllow: false }),
  );
  return { configured: true, token: token.toJwt(), identity };
}

// Per-state consent -- owner confirms the exact policy/wording before this
// ever dials a real customer; today it is the same line for every call.
export const CONSENT_LINE = 'This call may be recorded.';

export type VoiceTwimlInput = {
  toNumber: string;
  streamUrl: string;
  sessionId: string;
  // Absolute URL to POST /api/twilio/whisper -- see buildWhisperTwiml below.
  whisperUrl: string;
};

// This webhook's TwiML executes on whichever leg triggered it -- the REP's
// browser softphone leg (Device.connect() is what calls POST
// /api/twilio/voice; see LiveConsole.tsx), not the customer, who doesn't
// join until <Dial><Number> rings out and is answered. A bare .say() here
// would therefore only ever play to the rep (the H3 review finding: every
// coached call recorded the customer's audio with zero notice to them). The
// actual customer-facing notice is a Twilio "whisper": the Number noun's
// `url` attribute, which Twilio requests -- and plays -- on the CUSTOMER's
// own leg the instant it answers, before bridging it into the call (see
// buildWhisperTwiml).
export function buildVoiceTwiml(input: VoiceTwimlInput): string {
  const response = new twilio.twiml.VoiceResponse();

  const start = response.start();
  // both_tracks so the bridge gets audio from both legs of the call (the
  // rep's browser softphone leg and the dialed-out customer leg) -- which of
  // Twilio's "inbound"/"outbound" track labels ends up meaning which party
  // is UNVERIFIED until this runs against a real account; scripts/
  // live-bridge.mjs documents the same caveat where it maps track to
  // speaker. The sessionId parameter is how the bridge knows which
  // live_sessions row to post transcript segments against.
  const stream = start.stream({ url: input.streamUrl, track: 'both_tracks' });
  stream.parameter({ name: 'sessionId', value: input.sessionId });

  const dial = response.dial({ callerId: process.env.TWILIO_CALLER_ID ?? '' });
  dial.number({ url: input.whisperUrl }, input.toNumber);

  return response.toString();
}

// TwiML requested by the Number noun's whisper `url` above, once the
// CUSTOMER leg answers and before Twilio bridges it into the call with the
// rep -- this is what actually delivers the recording-consent notice to the
// customer.
export function buildWhisperTwiml(): string {
  const response = new twilio.twiml.VoiceResponse();
  response.say(CONSENT_LINE);
  return response.toString();
}

export type VerifySignatureInput = {
  url: string;
  params: Record<string, string>;
  signature: string | null;
};

export function verifyTwilioSignature(input: VerifySignatureInput): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return false;
  if (!input.signature) return false;
  return twilio.validateRequest(authToken, input.signature, input.url, input.params);
}

const STREAM_GRANT_BYTES = 32;

export function createMediaStreamGrant(): { grant: string; hash: string } {
  const grant = randomBytes(STREAM_GRANT_BYTES).toString('base64url');
  return { grant, hash: hashMediaStreamGrant(grant) };
}

export function hashMediaStreamGrant(grant: string): string {
  return createHash('sha256').update(grant, 'utf8').digest('hex');
}

// Twilio does not support query parameters on a Media Stream URL. Give every
// call a unique path instead: Twilio signs that exact path during the
// WebSocket upgrade, and the bridge consumes the random grant once. The
// session id in the path is also checked against Twilio's first `start`
// message before any Deepgram connection is opened.
export function buildLiveBridgeStreamUrl(
  baseUrl: string,
  sessionId: string,
  streamGrant = createMediaStreamGrant().grant,
): string {
  const base = new URL(baseUrl);
  if (
    base.protocol !== 'wss:' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !sessionId.trim() ||
    !/^[A-Za-z0-9_-]{43}$/.test(streamGrant)
  ) {
    throw new Error('Invalid live bridge stream URL configuration');
  }

  const basePath = base.pathname.replace(/\/+$/, '');
  base.pathname = `${basePath}/streams/${encodeURIComponent(sessionId)}/${streamGrant}`;
  return base.toString();
}

export function createDialGrant(): { grant: string; hash: string } {
  const grant = randomBytes(32).toString('base64url');
  return { grant, hash: hashDialGrant(grant) };
}

export function hashDialGrant(grant: string): string {
  return createHash('sha256').update(grant, 'utf8').digest('hex');
}

export function normalizeTwilioClientIdentity(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized.toLowerCase().startsWith('client:')) return null;
  const identity = normalized.slice('client:'.length).trim();
  return identity || null;
}

// Voice SDK identities allow only alphanumeric and underscore characters.
// Hash the immutable Auth UUID instead of leaking it or passing UUID hyphens.
export function twilioIdentityForAuthUserId(authUserId: string): string {
  return `yll_${createHash('sha256').update(authUserId, 'utf8').digest('hex')}`;
}
