import twilio from 'twilio';

const STREAM_GRANT_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function mediaStreamStartMatches(event, expectedSessionId, alreadyStarted) {
  return !!(
    !alreadyStarted &&
    event &&
    event.event === 'start' &&
    event.start?.customParameters?.sessionId === expectedSessionId
  );
}

export function isAllowedBridgeAppBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return !!(
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.pathname === '/' &&
    (url.protocol === 'https:' || (url.protocol === 'http:' && loopback))
  );
}

export async function consumeDurableMediaStreamGrant({
  appBaseUrl,
  bridgeSecret,
  sessionId,
  streamGrant,
  fetchImpl = fetch,
  signal = AbortSignal.timeout(3000),
}) {
  try {
    if (!isAllowedBridgeAppBaseUrl(appBaseUrl)) return 'unavailable';
    const authorizeUrl = new URL('/api/live/stream/authorize', appBaseUrl);
    const response = await fetchImpl(authorizeUrl, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'x-live-bridge-secret': bridgeSecret,
      },
      body: JSON.stringify({ sessionId, streamGrant }),
      signal,
    });
    if (response.ok) return 'authorized';
    return response.status >= 500 ? 'unavailable' : 'denied';
  } catch {
    return 'unavailable';
  }
}

export async function postLiveSegment({
  appBaseUrl,
  bridgeSecret,
  sessionId,
  speaker,
  text,
  silenceMs,
  fetchImpl = fetch,
  signal = AbortSignal.timeout(3000),
}) {
  try {
    if (!isAllowedBridgeAppBaseUrl(appBaseUrl)) return 'unavailable';
    const segmentUrl = new URL('/api/live/segment', appBaseUrl);
    const response = await fetchImpl(segmentUrl, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'x-live-bridge-secret': bridgeSecret,
      },
      body: JSON.stringify({ sessionId, speaker, text, silenceMs }),
      signal,
    });
    if (response.ok) return 'saved';
    return response.status >= 500 ? 'unavailable' : 'denied';
  } catch {
    return 'unavailable';
  }
}

function invalid(reason) {
  return { ok: false, reason };
}

// Authenticate the actual HTTP Upgrade request before `ws` accepts it. The
// public URL is reconstructed from the configured external wss:// origin and
// the request's raw path because a TLS proxy commonly changes the bridge's
// local Host/protocol. Twilio signs the external URL it received in TwiML.
export function authorizeMediaStreamUpgrade({
  requestUrl,
  signature,
  publicBridgeUrl,
  authToken,
}) {
  if (!requestUrl || !requestUrl.startsWith('/') || requestUrl.startsWith('//')) {
    return invalid('invalid_request_path');
  }
  if (!signature || !authToken) return invalid('missing_authentication');

  let base;
  try {
    base = new URL(publicBridgeUrl);
  } catch {
    return invalid('invalid_bridge_url');
  }
  if (
    base.protocol !== 'wss:' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    return invalid('invalid_bridge_url');
  }

  // Twilio Media Stream URLs do not support query parameters. Reject them
  // here too so the exact signed surface remains one predictable path shape.
  if (requestUrl.includes('?') || requestUrl.includes('#')) return invalid('invalid_request_path');

  const basePath = base.pathname.replace(/\/+$/, '');
  const expectedPrefix = `${basePath}/streams/`;
  let parsed;
  const publicUrl = `${base.origin}${requestUrl}`;
  try {
    parsed = new URL(publicUrl);
  } catch {
    return invalid('invalid_request_path');
  }
  if (!parsed.pathname.startsWith(expectedPrefix)) return invalid('invalid_request_path');

  const pathParts = parsed.pathname.slice(expectedPrefix.length).split('/');
  if (pathParts.length !== 2) return invalid('invalid_request_path');

  let sessionId;
  try {
    sessionId = decodeURIComponent(pathParts[0]);
  } catch {
    return invalid('invalid_request_path');
  }
  const streamGrant = pathParts[1];
  if (!SESSION_ID_PATTERN.test(sessionId) || !STREAM_GRANT_PATTERN.test(streamGrant)) {
    return invalid('invalid_stream_identity');
  }

  let validSignature = false;
  try {
    validSignature = twilio.validateRequest(authToken, signature, publicUrl, {});
  } catch {
    validSignature = false;
  }
  if (!validSignature) return invalid('invalid_signature');

  return { ok: true, publicUrl, sessionId, streamGrant };
}
