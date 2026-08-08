// POST /api/twilio/voice -- the TwiML App's Voice webhook. Twilio calls this
// directly (no browser session), so it is exempt from the staff-session
// employee gate in src/proxy.ts (see routePolicy.ts) and validates itself
// via the X-Twilio-Signature header (src/lib/live/twilioVoice.ts). Missing
// TWILIO_AUTH_TOKEN fails closed; there is no unauthenticated setup mode.
//
// The browser supplies only an opaque one-time dialGrant. The handler derives
// the session and customer destination from server-owned rows, binds the grant
// to Twilio's authenticated client identity, rechecks calling hours, and
// atomically consumes the grant before returning dialing TwiML.
//
// UNTESTED against a live Twilio account -- see twilioVoice.ts's header
// comment for the sources this was coded against.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { isWithinCallingHours } from '@/lib/leads/callingHours';
import {
  buildLiveBridgeStreamUrl,
  buildVoiceTwiml,
  createMediaStreamGrant,
  hashDialGrant,
  normalizeTwilioClientIdentity,
  twilioIdentityForAuthUserId,
  verifyTwilioSignature,
} from '@/lib/live/twilioVoice';
import type { LiveSessionRow } from '@/lib/live/types';

const XML_HEADERS = { 'Content-Type': 'text/xml' };
const MEDIA_STREAM_GRANT_TTL_MS = 5 * 60 * 1000;

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

  if (!isSupabaseConfigured()) {
    return new NextResponse(errorTwiml('Calling is temporarily unavailable.'), {
      status: 503,
      headers: XML_HEADERS,
    });
  }

  const dialGrant = params.dialGrant?.trim();
  const clientIdentity = normalizeTwilioClientIdentity(params.From);
  if (!dialGrant || !clientIdentity) {
    return new NextResponse(errorTwiml('This call is not authorized.'), {
      status: 400,
      headers: XML_HEADERS,
    });
  }

  const supabase = getSupabaseServerClient()!;
  const grantHash = hashDialGrant(dialGrant);
  const { data: sessionData, error: sessionError } = await supabase
    .from('live_sessions')
    .select('*')
    .eq('dial_grant_hash', grantHash)
    .maybeSingle();
  if (sessionError) {
    console.error('Load one-time Twilio dial grant failed:', sessionError);
    return new NextResponse(errorTwiml('Calling is temporarily unavailable.'), {
      status: 503,
      headers: XML_HEADERS,
    });
  }
  const session = sessionData as LiveSessionRow | null;
  const now = new Date();
  if (
    !session ||
    session.mode !== 'twilio' ||
    session.status !== 'active' ||
    session.dial_started_at !== null ||
    !session.dial_grant_expires_at ||
    new Date(session.dial_grant_expires_at).getTime() <= now.getTime() ||
    !session.dial_actor_auth_user_id ||
    twilioIdentityForAuthUserId(session.dial_actor_auth_user_id) !== clientIdentity
  ) {
    return new NextResponse(errorTwiml('This call authorization is invalid or expired.'), {
      status: 403,
      headers: XML_HEADERS,
    });
  }

  const { data: callData, error: callError } = await supabase
    .from('calls')
    .select('id, lead_id')
    .eq('id', session.call_id)
    .maybeSingle();
  if (callError || !callData) {
    return new NextResponse(errorTwiml('This call is no longer available.'), {
      status: callError ? 503 : 404,
      headers: XML_HEADERS,
    });
  }
  const leadId = (callData as { lead_id?: unknown }).lead_id;
  if (typeof leadId !== 'string' || !leadId) {
    return new NextResponse(errorTwiml('This call has no customer destination.'), {
      status: 409,
      headers: XML_HEADERS,
    });
  }

  const { data: leadData, error: leadError } = await supabase
    .from('leads')
    .select('phone, timezone')
    .eq('id', leadId)
    .maybeSingle();
  if (leadError || !leadData) {
    return new NextResponse(errorTwiml('This customer destination is unavailable.'), {
      status: leadError ? 503 : 404,
      headers: XML_HEADERS,
    });
  }
  const lead = leadData as { phone?: unknown; timezone?: unknown };
  const toNumber = typeof lead.phone === 'string' ? lead.phone.trim() : '';
  const timezone = typeof lead.timezone === 'string' ? lead.timezone : null;
  if (!toNumber) {
    return new NextResponse(errorTwiml('This customer has no phone number.'), {
      status: 409,
      headers: XML_HEADERS,
    });
  }
  if (!isWithinCallingHours(timezone, now)) {
    return new NextResponse(errorTwiml('This call is outside the customer calling hours.'), {
      status: 409,
      headers: XML_HEADERS,
    });
  }

  // Build and validate the unique, session-bound Media Stream URL before
  // consuming the dial grant. A bad bridge configuration must remain safely
  // retryable rather than burning the caller's one-time authorization.
  let streamUrl: string;
  const mediaStreamGrant = createMediaStreamGrant();
  try {
    if (!process.env.LIVE_BRIDGE_URL) throw new Error('LIVE_BRIDGE_URL is missing');
    streamUrl = buildLiveBridgeStreamUrl(
      process.env.LIVE_BRIDGE_URL,
      session.id,
      mediaStreamGrant.grant,
    );
  } catch (error) {
    console.error('Live bridge URL configuration is invalid:', error instanceof Error ? error.message : error);
    return new NextResponse(errorTwiml('Calling is temporarily unavailable.'), {
      status: 503,
      headers: XML_HEADERS,
    });
  }

  const nowIso = now.toISOString();
  const mediaStreamGrantExpiresAt = new Date(
    now.getTime() + MEDIA_STREAM_GRANT_TTL_MS,
  ).toISOString();
  const { data: consumedRows, error: consumeError } = await supabase
    .from('live_sessions')
    .update({
      dial_started_at: nowIso,
      media_stream_grant_hash: mediaStreamGrant.hash,
      media_stream_grant_expires_at: mediaStreamGrantExpiresAt,
      media_stream_started_at: null,
    })
    .eq('id', session.id)
    .eq('status', 'active')
    .eq('dial_grant_hash', grantHash)
    .is('dial_started_at', null)
    .gt('dial_grant_expires_at', nowIso)
    .select('id');
  if (consumeError) {
    console.error('Consume one-time Twilio dial grant failed:', consumeError);
    return new NextResponse(errorTwiml('Calling is temporarily unavailable.'), {
      status: 503,
      headers: XML_HEADERS,
    });
  }
  if (!consumedRows || consumedRows.length !== 1) {
    return new NextResponse(errorTwiml('This call authorization was already used.'), {
      status: 409,
      headers: XML_HEADERS,
    });
  }

  // Same host Twilio just used to reach this webhook -- the whisper route
  // lives in this same Next app (not the media bridge), so there is no
  // separate env var for it, just this request's own origin.
  const whisperUrl = new URL('/api/twilio/whisper', request.url).toString();

  const twiml = buildVoiceTwiml({
    toNumber,
    streamUrl,
    sessionId: session.id,
    whisperUrl,
  });
  return new NextResponse(twiml, { headers: XML_HEADERS });
}
