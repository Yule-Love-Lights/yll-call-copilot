// POST /api/twilio/whisper -- the TwiML App's whisper webhook for the
// CUSTOMER leg: buildVoiceTwiml() (src/lib/live/twilioVoice.ts) puts this
// URL on the <Dial><Number> noun's `url` attribute, so Twilio requests it
// the instant the dialed-out customer answers, and plays whatever TwiML it
// gets back to that leg BEFORE bridging it into the call with the rep. This
// is what actually delivers the recording-consent notice to the customer
// (see the H3 review finding: a bare .say() in buildVoiceTwiml only ever
// played to the rep's own leg, since that's the leg that triggers
// POST /api/twilio/voice in the first place).
//
// Twilio calls this directly (no browser session) -- exempt from the
// employee-session gate in src/proxy.ts (see routePolicy.ts) and validated
// the same way as /api/twilio/voice: X-Twilio-Signature, checked via
// verifyTwilioSignature. Missing TWILIO_AUTH_TOKEN fails closed.

import { NextResponse } from 'next/server';
import { buildWhisperTwiml, verifyTwilioSignature } from '@/lib/live/twilioVoice';

const XML_HEADERS = { 'Content-Type': 'text/xml' };

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

  return new NextResponse(buildWhisperTwiml(), { headers: XML_HEADERS });
}
