// POST /api/live/stream/authorize -- bridge-only, durable consumption of the
// Media Stream grant embedded in Twilio's already signature-validated
// WebSocket path. The conditional update is the shared replay boundary: only
// one bridge replica can consume an unexpired grant, and the stored digest is
// retained after use so a restart never makes it reusable.

import { NextResponse } from 'next/server';
import { verifyHeaderSecret } from '@/lib/auth/machine';
import { hashMediaStreamGrant } from '@/lib/live/twilioVoice';
import { getSupabaseServerClient, isSupabaseConfigured } from '@/lib/supabase';

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const STREAM_GRANT_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }

  const auth = verifyHeaderSecret(
    request,
    'x-live-bridge-secret',
    process.env.LIVE_BRIDGE_SECRET,
  );
  if (auth === 'unconfigured') {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }
  if (auth !== 'authorized') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const sessionId =
    typeof body?.sessionId === 'string' && SESSION_ID_PATTERN.test(body.sessionId)
      ? body.sessionId
      : null;
  const streamGrant =
    typeof body?.streamGrant === 'string' && STREAM_GRANT_PATTERN.test(body.streamGrant)
      ? body.streamGrant
      : null;
  if (!sessionId || !streamGrant) {
    return NextResponse.json({ error: 'Invalid stream authorization' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const supabase = getSupabaseServerClient()!;
  const { data, error } = await supabase
    .from('live_sessions')
    .update({ media_stream_started_at: now })
    .eq('id', sessionId)
    .eq('mode', 'twilio')
    .eq('status', 'active')
    .eq('media_stream_grant_hash', hashMediaStreamGrant(streamGrant))
    .is('media_stream_started_at', null)
    .gt('media_stream_grant_expires_at', now)
    .select('id');

  if (error) {
    console.error('Consume Media Stream grant failed:', error);
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }
  if (!data || data.length !== 1) {
    return NextResponse.json({ error: 'Invalid or already used stream authorization' }, { status: 403 });
  }

  return NextResponse.json(
    { authorized: true, sessionId },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
