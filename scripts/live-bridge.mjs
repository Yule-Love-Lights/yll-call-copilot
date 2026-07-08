// Standalone Deepgram bridge for Twilio Media Streams. Next.js route
// handlers cannot hold a long-lived websocket, so this runs as its own
// process instead: a plain `ws` WebSocket SERVER that Twilio's
// <Start><Stream> connects to as a client (one connection per call), which
// forwards the mulaw audio to a Deepgram live transcription connection and
// POSTs finalized utterances to this app's POST /api/live/segment.
//
// UNTESTED against a live Twilio/Deepgram account -- no account exists yet
// (see the Phase 4 brief). Coded against the installed package versions'
// actual documented APIs, verified by introspecting node_modules directly
// rather than from memory, since @deepgram/sdk's real-time API shape
// changed across major versions. The always-available simulator
// (src/lib/live/simulator.ts, driven from the browser) is the verified demo
// path; this is the parallel path for once the accounts exist.
//
// Run: node scripts/live-bridge.mjs
// Reads DEEPGRAM_API_KEY, LIVE_BRIDGE_SECRET, LIVE_APP_BASE_URL, and
// LIVE_BRIDGE_PORT from the shell env or .env.local (same manual loader
// scripts/create-user.mjs uses -- this is a plain Node script, not part of
// the Next.js build, so it does not get automatic env loading).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { DefaultDeepgramClient } from '@deepgram/sdk';

function loadEnvLocal() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let text;
  try {
    text = readFileSync(resolve(root, '.env.local'), 'utf8');
  } catch {
    return {};
  }
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const fileEnv = loadEnvLocal();
function envVar(name, fallback) {
  return process.env[name] || fileEnv[name] || fallback;
}

const DEEPGRAM_API_KEY = envVar('DEEPGRAM_API_KEY');
const LIVE_BRIDGE_SECRET = envVar('LIVE_BRIDGE_SECRET');
const LIVE_APP_BASE_URL = envVar('LIVE_APP_BASE_URL', 'http://localhost:3000');
const PORT = Number(envVar('LIVE_BRIDGE_PORT', '8787'));

if (!DEEPGRAM_API_KEY) {
  console.error('DEEPGRAM_API_KEY is not set (checked shell env and .env.local) -- the bridge cannot transcribe without it.');
  process.exit(1);
}
if (!LIVE_BRIDGE_SECRET) {
  console.error(
    'LIVE_BRIDGE_SECRET is not set (checked shell env and .env.local) -- set the same value the Next.js app has, or POST /api/live/segment will reject every segment this bridge sends.',
  );
  process.exit(1);
}

const deepgram = new DefaultDeepgramClient({ apiKey: DEEPGRAM_API_KEY });

// A caller-side gap at least this long is worth reporting as a SILENCE
// trigger (see src/lib/live/engine.ts's SILENCE_THRESHOLD_MS, 4000ms --
// reported here at a lower bound so a slightly-shorter real gap still
// reaches the engine, which does the actual threshold check).
const SILENCE_REPORT_THRESHOLD_MS = 1500;

async function postSegment(sessionId, speaker, text, silenceMs) {
  try {
    const res = await fetch(`${LIVE_APP_BASE_URL}/api/live/segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-live-bridge-secret': LIVE_BRIDGE_SECRET },
      body: JSON.stringify({ sessionId, speaker, text, silenceMs }),
    });
    if (!res.ok) console.error(`POST /api/live/segment -> HTTP ${res.status}`);
  } catch (err) {
    console.error('POST /api/live/segment failed:', err instanceof Error ? err.message : err);
  }
}

// Twilio Media Streams' "both_tracks" mode (see buildVoiceTwiml in
// src/lib/live/twilioVoice.ts) labels each media frame "inbound" (audio
// FROM the caller into this leg) or "outbound" (audio TO the caller). This
// leg's "caller" is the rep's browser softphone -- it originated the
// connection into the TwiML app -- so inbound should be the rep's mic and
// outbound the dialed-out customer's voice, relayed back once <Dial>
// bridges the two legs. UNVERIFIED against a live call: flip this mapping
// if speaker labels come out swapped once a real account exists.
const TRACK_TO_SPEAKER = { inbound: 'rep', outbound: 'customer' };

function handleTwilioConnection(ws) {
  let sessionId = null;
  let currentSpeaker = 'customer';
  let lastFinalAt = null;
  let deepgramSocketPromise = null;

  function ensureDeepgramSocket() {
    if (deepgramSocketPromise) return deepgramSocketPromise;

    deepgramSocketPromise = (async () => {
      // Diarize stays on per the brief even though the Twilio `track` field
      // (read below, per media frame) is the ground truth for who is
      // talking on this call -- Deepgram's own diarization is not consulted
      // for speaker labeling, only its transcript text.
      const socket = await deepgram.listen.v1.connect({
        model: 'nova-2',
        encoding: 'mulaw',
        sample_rate: 8000,
        channels: 1,
        diarize: 'true',
        interim_results: 'true',
        Authorization: `Token ${DEEPGRAM_API_KEY}`,
      });
      await socket.waitForOpen();

      socket.on('error', err => console.error('Deepgram socket error:', err));
      socket.on('close', () => console.log('Deepgram socket closed.'));
      socket.on('message', message => {
        if (message.type !== 'Results' || !message.is_final) return;
        const text = message.channel?.alternatives?.[0]?.transcript?.trim();
        if (!text) return;

        const now = Date.now();
        const silenceMs = lastFinalAt && now - lastFinalAt >= SILENCE_REPORT_THRESHOLD_MS ? now - lastFinalAt : undefined;
        lastFinalAt = now;
        if (sessionId) postSegment(sessionId, currentSpeaker, text, silenceMs);
      });

      return socket;
    })();

    return deepgramSocketPromise;
  }

  ws.on('message', async raw => {
    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }

    try {
      if (event.event === 'start') {
        sessionId = event.start?.customParameters?.sessionId ?? null;
        if (!sessionId) console.error('Twilio stream started with no sessionId custom parameter -- cannot post segments for this call.');
        return;
      }

      if (event.event === 'media') {
        const track = event.media?.track;
        currentSpeaker = TRACK_TO_SPEAKER[track] ?? 'customer';
        const socket = await ensureDeepgramSocket();
        socket.sendMedia(Buffer.from(event.media.payload, 'base64'));
        return;
      }

      if (event.event === 'stop') {
        const socket = deepgramSocketPromise ? await deepgramSocketPromise.catch(() => null) : null;
        socket?.close();
        deepgramSocketPromise = null;
      }
    } catch (err) {
      // A single bad/late frame must never take down the whole bridge
      // process -- every other call it is handling keeps running.
      console.error('Error handling a Twilio media-stream event:', err instanceof Error ? err.message : err);
    }
  });

  ws.on('close', async () => {
    const socket = deepgramSocketPromise ? await deepgramSocketPromise.catch(() => null) : null;
    socket?.close();
    deepgramSocketPromise = null;
  });
}

const wss = new WebSocketServer({ port: PORT });
wss.on('connection', handleTwilioConnection);
console.log(`Live coaching bridge listening on ws://localhost:${PORT}.`);
console.log('Twilio Media Streams requires a wss:// URL in production -- put a TLS tunnel (e.g. ngrok) in front of this port and set LIVE_BRIDGE_URL to it.');
