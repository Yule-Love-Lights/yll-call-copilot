// POST /api/twilio/voice -- the TwiML App's Voice webhook. Twilio calls this
// directly (no browser session), so it is exempt from the staff-session
// gate in src/proxy.ts (see PUBLIC_PATHS there) and validates itself instead
// via the X-Twilio-Signature header (src/lib/live/twilioVoice.ts's
// verifyTwilioSignature, a no-op until TWILIO_AUTH_TOKEN is set -- there is
// no live account yet).
//
// The rep's browser Device.connect({ params: { To, sessionId } }) (see
// LiveConsole.tsx) forwards both as ordinary form fields on this request:
// `To` is the lead's phone number to dial out to, `sessionId` is the
// live_sessions row already created by POST /api/live/start, threaded
// through to the Media Stream as a <Parameter> so scripts/live-bridge.mjs
// knows which session to post transcript segments against.
//
// UNTESTED against a live Twilio account -- see twilioVoice.ts's header
// comment for the sources this was coded against.

import { NextResponse } from 'next/server';
import { buildVoiceTwiml, verifyTwilioSignature } from '@/lib/live/twilioVoice';

const XML_HEADERS = { 'Content-Type': 'text/xml' };

function errorTwiml(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${message}</Say></Response>`;
}

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const params: Record<string, string> = {};
  if (formData) {
    for (const [key, value] of formData.entries()) {
      if (typeof value === 'string') params[key] = value;
    }
  }

  const signature = request.headers.get('x-twilio-signature');
  if (!verifyTwilioSignature({ url: request.url, params, signature })) {
    return NextResponse.json({ error: 'Invalid Twilio signature' }, { status: 403 });
  }

  const toNumber = params.To;
  const sessionId = params.sessionId;
  if (!toNumber || !sessionId) {
    return new NextResponse(errorTwiml('This call is missing the destination number or session, and cannot continue.'), {
      status: 400,
      headers: XML_HEADERS,
    });
  }

  // The bridge's public address -- see scripts/live-bridge.mjs. Twilio Media
  // Streams requires wss:// in production; the localhost default only works
  // for local dev against a tunnel that already terminates TLS (e.g. ngrok).
  const streamUrl = process.env.LIVE_BRIDGE_URL ?? 'wss://localhost:8787';

  // Same host Twilio just used to reach this webhook -- the whisper route
  // lives in this same Next app (not the media bridge), so there is no
  // separate env var for it, just this request's own origin.
  const whisperUrl = new URL('/api/twilio/whisper', request.url).toString();

  const twiml = buildVoiceTwiml({ toNumber, streamUrl, sessionId, whisperUrl });
  return new NextResponse(twiml, { headers: XML_HEADERS });
}
