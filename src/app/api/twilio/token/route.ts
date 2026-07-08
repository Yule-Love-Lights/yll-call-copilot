// GET /api/twilio/token -- a Voice access token for the rep's browser
// softphone (@twilio/voice-sdk's Device). Behind the normal staff-session
// gate like every other route (not public), so identity defaults to the
// signed-in rep's email. {configured:false} when Twilio env is absent (no
// account exists yet) -- the client falls back to simulator mode.

import { NextResponse } from 'next/server';
import { getSessionEmail } from '@/lib/auth/session';
import { buildVoiceAccessToken, isTwilioConfigured } from '@/lib/live/twilioVoice';

export async function GET() {
  if (!isTwilioConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const identity = (await getSessionEmail()) ?? 'rep';
  return NextResponse.json(buildVoiceAccessToken(identity));
}
