// Twilio's signed Voice webhook. The browser sends only a one-time grant.
// The database locks and revalidates the employee, current lead claim,
// destination, calling window, call, and session before consuming it.

import { NextResponse } from 'next/server';
import { getContact, getOpportunitiesForContact, getStageNameMap, isHighLevelConfigured } from '@/lib/ghl/client';
import { isCallable } from '@/lib/leads/scoring';
import { getSupabaseServerClient, isSupabaseConfigured } from '@/lib/supabase';
import {
  buildLiveBridgeStreamUrl,
  buildVoiceTwiml,
  hashDialGrant,
  isTwilioConfigured,
  normalizeTwilioClientIdentity,
  twilioIdentityForAuthUserId,
  verifyTwilioSignature,
} from '@/lib/live/twilioVoice';
import { normalizePhone } from '@/lib/scoreboard/flywheel';

const XML_HEADERS = { 'Content-Type': 'text/xml' };
const CURRENT_CONTACT_TIMEOUT_MS = 4000;

function errorTwiml(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${message}</Say></Response>`;
}

type DialResult = {
  result_code: string;
  session_id: string | null;
  call_id: string | null;
  lead_id: string | null;
  to_number: string | null;
  contact_timezone: string | null;
};

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Current contact verification timed out.')), CURRENT_CONTACT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const params: Record<string, string> = {};
  if (formData) {
    for (const [key, value] of formData.entries()) {
      if (typeof value === 'string') params[key] = value;
    }
  }
  if (!verifyTwilioSignature({
    url: request.url,
    params,
    signature: request.headers.get('x-twilio-signature'),
  })) {
    return NextResponse.json({ error: 'Invalid Twilio signature' }, { status: 403 });
  }
  if (!isTwilioConfigured()) {
    return new NextResponse(errorTwiml('Calling is temporarily unavailable.'), { status: 503, headers: XML_HEADERS });
  }
  if (!isSupabaseConfigured()) {
    return new NextResponse(errorTwiml('Calling is temporarily unavailable.'), { status: 503, headers: XML_HEADERS });
  }

  const dialGrant = params.dialGrant?.trim();
  const clientIdentity = normalizeTwilioClientIdentity(params.From);
  if (!dialGrant || !clientIdentity) {
    return new NextResponse(errorTwiml('This call is not authorized.'), { status: 400, headers: XML_HEADERS });
  }

  // Validate bridge configuration before the one-time database grant is
  // consumed. The real session id is substituted only after authorization.
  // Reuse the opaque one-time dial grant as the Media Stream grant. This
  // makes Twilio's retry of the same signed webhook deterministic after a
  // lost response, while the database still stores only its digest.
  const mediaGrant = { grant: dialGrant, hash: hashDialGrant(dialGrant) };
  try {
    if (!process.env.LIVE_BRIDGE_URL) throw new Error('LIVE_BRIDGE_URL is missing');
    buildLiveBridgeStreamUrl(
      process.env.LIVE_BRIDGE_URL,
      '00000000-0000-4000-8000-000000000000',
      mediaGrant.grant,
    );
  } catch (caught) {
    console.error('Live bridge URL configuration is invalid:', caught instanceof Error ? caught.message : caught);
    return new NextResponse(errorTwiml('Calling is temporarily unavailable.'), { status: 503, headers: XML_HEADERS });
  }

  const supabase = getSupabaseServerClient()!;
  const dialGrantHash = hashDialGrant(dialGrant);
  // Discovery only. The RPC locks the durable actor and revalidates this
  // binding before any call transition.
  const { data: discoveredSession, error: discoveryError } = await supabase
    .from('live_sessions')
    .select('dial_actor_auth_user_id, lead_id')
    .eq('dial_grant_hash', dialGrantHash)
    .maybeSingle();
  const authUserId = (discoveredSession as { dial_actor_auth_user_id?: string | null } | null)?.dial_actor_auth_user_id ?? null;
  const discoveredLeadId = (discoveredSession as { lead_id?: string | null } | null)?.lead_id ?? null;
  if (discoveryError) {
    console.error('Discover live dial actor failed:', discoveryError);
    return new NextResponse(errorTwiml('Calling is temporarily unavailable.'), { status: 503, headers: XML_HEADERS });
  }
  if (!authUserId || !discoveredLeadId || twilioIdentityForAuthUserId(authUserId) !== clientIdentity) {
    return new NextResponse(errorTwiml('This call authorization is invalid or expired.'), { status: 403, headers: XML_HEADERS });
  }

  // The queue-time DNC check can be hours old. Re-read the current CRM flag,
  // tags, and pipeline stages immediately before the database consumes the
  // dial grant. A CRM outage fails closed and leaves the setup retryable.
  if (!isHighLevelConfigured()) {
    return new NextResponse(errorTwiml('Calling is temporarily unavailable.'), { status: 503, headers: XML_HEADERS });
  }
  const { data: discoveredLead, error: leadError } = await supabase
    .from('leads')
    .select('ghl_contact_id')
    .eq('id', discoveredLeadId)
    .maybeSingle();
  const contactId = (discoveredLead as { ghl_contact_id?: string | null } | null)?.ghl_contact_id ?? null;
  if (leadError || !contactId) {
    return new NextResponse(errorTwiml('This customer destination is unavailable.'), {
      status: leadError ? 503 : 409,
      headers: XML_HEADERS,
    });
  }
  let verifiedToNumber: string;
  let verifiedTimezone: string;
  try {
    const [contact, opportunities, stageNames] = await withTimeout(Promise.all([
      getContact(contactId),
      getOpportunitiesForContact(contactId),
      getStageNameMap(),
    ]));
    const currentStages = opportunities
      .map(opportunity => opportunity.pipelineStageId ? stageNames.get(opportunity.pipelineStageId) : null)
      .filter((stage): stage is string => !!stage);
    if (!isCallable({ dnd: contact.dnd, dndSettings: contact.dndSettings, tags: contact.tags ?? [], stageNames: currentStages })) {
      return new NextResponse(errorTwiml('This contact cannot be called.'), { status: 409, headers: XML_HEADERS });
    }
    const currentPhone = normalizePhone(contact.phone);
    if (!currentPhone) {
      return new NextResponse(errorTwiml('This customer has no valid phone number.'), { status: 409, headers: XML_HEADERS });
    }
    verifiedToNumber = currentPhone;
    verifiedTimezone = contact.timezone?.trim() || 'America/New_York';
  } catch (caught) {
    console.error('Live do-not-call verification failed:', caught);
    return new NextResponse(errorTwiml('Calling is temporarily unavailable.'), { status: 503, headers: XML_HEADERS });
  }

  if (request.signal.aborted) {
    return new NextResponse(errorTwiml('Calling is temporarily unavailable.'), { status: 503, headers: XML_HEADERS });
  }

  const { data, error } = await supabase.rpc('consume_authorized_live_dial', {
    p_dial_grant_hash: dialGrantHash,
    p_actor_auth_user_id: authUserId,
    p_media_stream_grant_hash: mediaGrant.hash,
    p_verified_contact_id: contactId,
    p_verified_to_number: verifiedToNumber,
    p_verified_timezone: verifiedTimezone,
  });
  if (error) {
    console.error('Consume live dial grant failed:', error);
    return new NextResponse(errorTwiml('Calling is temporarily unavailable.'), { status: 503, headers: XML_HEADERS });
  }
  const result = (Array.isArray(data) ? data[0] : data) as DialResult | null;
  if (!result) {
    return new NextResponse(errorTwiml('Calling is temporarily unavailable.'), { status: 503, headers: XML_HEADERS });
  }
  if (result.result_code === 'outside_calling_hours') {
    return new NextResponse(errorTwiml('This call is outside the customer calling hours.'), { status: 409, headers: XML_HEADERS });
  }
  if (result.result_code === 'missing_destination') {
    return new NextResponse(errorTwiml('This customer has no phone number.'), { status: 409, headers: XML_HEADERS });
  }
  if (!['authorized', 'already_authorized'].includes(result.result_code) || !result.session_id || !result.to_number) {
    const unavailable = result.result_code === 'actor_inactive';
    return new NextResponse(errorTwiml('This call authorization is invalid or expired.'), {
      status: unavailable ? 503 : 403,
      headers: XML_HEADERS,
    });
  }

  let streamUrl: string;
  try {
    streamUrl = buildLiveBridgeStreamUrl(process.env.LIVE_BRIDGE_URL!, result.session_id, mediaGrant.grant);
  } catch (caught) {
    // Prevalidation above makes this unreachable unless configuration changes
    // during one request. Fail closed and leave the attempt visible to end.
    console.error('Build authorized bridge URL failed:', caught);
    return new NextResponse(errorTwiml('Calling is temporarily unavailable.'), { status: 503, headers: XML_HEADERS });
  }

  const twiml = buildVoiceTwiml({
    toNumber: result.to_number,
    streamUrl,
    sessionId: result.session_id,
    whisperUrl: new URL('/api/twilio/whisper', request.url).toString(),
  });
  return new NextResponse(twiml, { headers: XML_HEADERS });
}
