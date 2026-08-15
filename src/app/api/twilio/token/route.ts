// GET /api/twilio/token -- a Voice access token for the rep's browser
// softphone (@twilio/voice-sdk's Device). Behind the normal staff-session
// gate like every other route (not public), so identity defaults to the
// signed-in rep's email. {configured:false} when Twilio env is absent (no
// account exists yet). The client sends employees to the separate Practice
// module; missing phone configuration never creates work against a real lead.

import { NextResponse } from 'next/server';
import { resolveCurrentHubActor } from '@/lib/auth/resource';
import {
  buildVoiceAccessToken,
  isTwilioConfigured,
  twilioIdentityForAuthUserId,
} from '@/lib/live/twilioVoice';

export async function GET() {
  if (!isTwilioConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const actorResolution = await resolveCurrentHubActor();
  if (actorResolution.status !== 'resolved') {
    return NextResponse.json(
      { error: 'Access denied.' },
      { status: actorResolution.status === 'unavailable' ? 503 : 403 },
    );
  }
  return NextResponse.json(
    buildVoiceAccessToken(
      twilioIdentityForAuthUserId(actorResolution.actor.authUserId),
    ),
  );
}
