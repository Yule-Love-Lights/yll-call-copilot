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
// changed across major versions. Employee training stays in /practice and
// never passes through this customer-call bridge.
//
// Run: node scripts/live-bridge.mjs
// Reads DEEPGRAM_API_KEY, LIVE_BRIDGE_SECRET, LIVE_BRIDGE_URL,
// TWILIO_AUTH_TOKEN, LIVE_APP_BASE_URL, and LIVE_BRIDGE_PORT from the shell
// env or .env.local (same manual loader scripts/create-user.mjs uses -- this
// is a plain Node script, not part of the Next.js build, so it does not get
// automatic env loading).

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { DefaultDeepgramClient } from '@deepgram/sdk';
import {
  authorizeMediaStreamUpgrade,
  consumeDurableMediaStreamGrant,
  isAllowedBridgeAppBaseUrl,
  mediaStreamStartMatches,
  postLiveSegment,
} from './live-bridge-auth.mjs';

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
const LIVE_CUSTOMER_CALLS_ENABLED = envVar('LIVE_CUSTOMER_CALLS_ENABLED', 'false');
const LIVE_BRIDGE_SECRET = envVar('LIVE_BRIDGE_SECRET');
const LIVE_BRIDGE_URL = envVar('LIVE_BRIDGE_URL');
const TWILIO_AUTH_TOKEN = envVar('TWILIO_AUTH_TOKEN');
const LIVE_APP_BASE_URL = envVar('LIVE_APP_BASE_URL', 'http://localhost:3000');
const PORT = Number(process.env.PORT || envVar('LIVE_BRIDGE_PORT', '8787'));

if (LIVE_CUSTOMER_CALLS_ENABLED !== 'true') {
  console.error('LIVE_CUSTOMER_CALLS_ENABLED is not true -- the unvalidated customer-call bridge will not start.');
  process.exit(1);
}
if (!DEEPGRAM_API_KEY) {
  console.error('DEEPGRAM_API_KEY is not set (checked shell env and .env.local) -- the bridge cannot transcribe without it.');
  process.exit(1);
}
if (
  !LIVE_BRIDGE_SECRET ||
  LIVE_BRIDGE_SECRET !== LIVE_BRIDGE_SECRET.trim() ||
  LIVE_BRIDGE_SECRET.length < 16
) {
  console.error(
    'LIVE_BRIDGE_SECRET must be an unpadded value of at least 16 characters (checked shell env and .env.local) and must match the Next.js app.',
  );
  process.exit(1);
}
if (!LIVE_BRIDGE_URL) {
  console.error('LIVE_BRIDGE_URL is not set -- the bridge cannot validate Twilio\'s exact public WebSocket URL.');
  process.exit(1);
}
if (!TWILIO_AUTH_TOKEN) {
  console.error('TWILIO_AUTH_TOKEN is not set -- the bridge rejects every unsigned WebSocket upgrade.');
  process.exit(1);
}
if (!isAllowedBridgeAppBaseUrl(LIVE_APP_BASE_URL)) {
  console.error('LIVE_APP_BASE_URL must use https://, except loopback http:// is allowed for local development.');
  process.exit(1);
}

const deepgram = new DefaultDeepgramClient({ apiKey: DEEPGRAM_API_KEY });

// PORT: a managed host (Railway/Render/Fly) assigns the public port via the
// PORT env var and expects the process to bind to it; LIVE_BRIDGE_PORT/8787 is
// only the local-dev fallback. process.env.PORT wins so the same file runs
// unchanged whether hosted or local.
// (see the const PORT line above for the resolved value)

// A caller-side gap at least this long is worth reporting as a SILENCE
// trigger (see src/lib/live/engine.ts's SILENCE_THRESHOLD_MS, 4000ms --
// reported here at a lower bound so a slightly-shorter real gap still
// reaches the engine, which does the actual threshold check).
const SILENCE_REPORT_THRESHOLD_MS = 1500;

async function postSegment(sessionId, sourceSegmentId, speaker, text, atMs, silenceMs) {
  const input = {
    appBaseUrl: LIVE_APP_BASE_URL,
    bridgeSecret: LIVE_BRIDGE_SECRET,
    sessionId,
    sourceSegmentId,
    speaker,
    text,
    atMs,
    silenceMs,
  };
  let result = await postLiveSegment(input);
  // A transient Hub failure is safe to retry because sourceSegmentId is
  // stable and the database accepts each finalized utterance only once.
  if (result === 'unavailable') result = await postLiveSegment(input);
  if (result !== 'saved') {
    console.error(`POST /api/live/segment failed closed: ${result}`);
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

function handleTwilioConnection(ws, expectedSessionId) {
  let sessionId = null;
  let streamStarted = false;
  let streamStartedAt = null;
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
        // Finalize an utterance after 300ms of silence instead of Deepgram's
        // slower default. We only act on is_final results (below), so without
        // this the card waited ~1s+ after the customer stopped talking just
        // for the transcript to settle. 300ms trades a little more
        // fragmentation for a card that lands while it is still useful.
        endpointing: 300,
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
        if (sessionId && streamStartedAt) {
          postSegment(
            sessionId,
            randomUUID(),
            currentSpeaker,
            text,
            Math.max(0, now - streamStartedAt),
            silenceMs,
          );
        }
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
        if (!mediaStreamStartMatches(event, expectedSessionId, streamStarted)) {
          console.error('Twilio stream start did not match its signed session path.');
          ws.close(1008, 'Invalid stream session');
          return;
        }
        sessionId = expectedSessionId;
        streamStarted = true;
        streamStartedAt = Date.now();
        return;
      }

      if (event.event === 'media') {
        if (!streamStarted) {
          ws.close(1008, 'Stream start required');
          return;
        }
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

// Attach the WebSocket server to a plain HTTP server rather than binding the
// ws server to the port directly. Two reasons: managed hosts (Railway/Render/
// Fly) health-check the service with an ordinary HTTP GET and mark the deploy
// unhealthy if nothing answers, and the same server both serves that 200 and
// upgrades the Twilio Media Stream connection on one port. GET / -> "ok".
const httpServer = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('yll-call-copilot live-coaching bridge: ok\n');
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found\n');
});
const wss = new WebSocketServer({ noServer: true });

function rejectUpgrade(socket, statusCode, message) {
  const body = `${message}\n`;
  const statusText = statusCode === 503 ? 'Service Unavailable' : 'Unauthorized';
  socket.write(
    `HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
  socket.destroy();
}

httpServer.on('upgrade', async (request, socket, head) => {
  const rawSignature = request.headers['x-twilio-signature'];
  const signature = Array.isArray(rawSignature) ? rawSignature[0] : rawSignature;
  const authorization = authorizeMediaStreamUpgrade({
    requestUrl: request.url,
    signature,
    publicBridgeUrl: LIVE_BRIDGE_URL,
    authToken: TWILIO_AUTH_TOKEN,
  });
  if (!authorization.ok) {
    console.warn(`Rejected live bridge WebSocket upgrade: ${authorization.reason}`);
    rejectUpgrade(socket, 401, 'Unauthorized');
    return;
  }

  // The signature proves this exact path came from Twilio. The Hub then
  // atomically consumes the path's random grant in the shared database. No
  // process-local cache is trusted, so restart and multi-replica replays fail.
  socket.pause();
  const durableAuthorization = await consumeDurableMediaStreamGrant({
    appBaseUrl: LIVE_APP_BASE_URL,
    bridgeSecret: LIVE_BRIDGE_SECRET,
    sessionId: authorization.sessionId,
    streamGrant: authorization.streamGrant,
  });
  if (durableAuthorization !== 'authorized') {
    rejectUpgrade(
      socket,
      durableAuthorization === 'unavailable' ? 503 : 401,
      durableAuthorization === 'unavailable' ? 'Service unavailable' : 'Unauthorized',
    );
    return;
  }
  if (socket.destroyed) return;
  socket.resume();

  wss.handleUpgrade(request, socket, head, ws => {
    handleTwilioConnection(ws, authorization.sessionId);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Live coaching bridge listening on :${PORT} (HTTP health + WebSocket upgrade).`);
  console.log('Hosted: point LIVE_BRIDGE_URL at the public wss:// URL of this service. Local: put a TLS tunnel in front of this port.');
});
