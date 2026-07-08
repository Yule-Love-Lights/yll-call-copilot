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

import twilio from 'twilio';

const { AccessToken } = twilio.jwt;
const { VoiceGrant } = AccessToken;

// The four credentials needed to mint a Voice access token and dial out.
// TWILIO_AUTH_TOKEN is checked separately (verifyTwilioSignature) since it
// only matters for validating inbound webhook signatures, not for placing a
// call -- a deliberate addition beyond the brief's six-var list, because
// "validate X-Twilio-Signature when configured" needs a credential to
// validate against and the Account SID/API key pair cannot do that (Twilio
// signs webhook requests with the Auth Token specifically).
export function isTwilioConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_API_KEY_SID &&
    process.env.TWILIO_API_KEY_SECRET &&
    process.env.TWILIO_TWIML_APP_SID &&
    process.env.TWILIO_CALLER_ID
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
};

export function buildVoiceTwiml(input: VoiceTwimlInput): string {
  const response = new twilio.twiml.VoiceResponse();
  response.say(CONSENT_LINE);

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
  dial.number(input.toNumber);

  return response.toString();
}

export type VerifySignatureInput = {
  url: string;
  params: Record<string, string>;
  signature: string | null;
};

export function verifyTwilioSignature(input: VerifySignatureInput): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  // No auth token configured -- there is no live account to validate
  // against yet, so let the (already env-gated) webhook through unchecked.
  // Once a real account + TWILIO_AUTH_TOKEN exist, every request is
  // verified.
  if (!authToken) return true;
  if (!input.signature) return false;
  return twilio.validateRequest(authToken, input.signature, input.url, input.params);
}
