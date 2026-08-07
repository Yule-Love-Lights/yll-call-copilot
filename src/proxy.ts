// Staff-only gate for every route. Next 16 renamed the middleware file
// convention to proxy (and with the src/ layout it lives here, next to app/).
// Flow: refresh the Supabase session from cookies, require a signed-in user,
// then require that user's email to be in app_users (the staff allowlist).
// Pages redirect to /login; API routes get JSON errors. Missing or invalid
// Supabase configuration fails closed for every protected or machine request.

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { checkAllowlist, shouldDenyAccess } from '@/lib/auth/allowlist';
import { resolveServerAuthConfiguration } from '@/lib/auth/config';

// /api/webhooks/ghl has no user session (GoHighLevel calls it directly) —
// it authenticates itself with a shared-secret query param instead (see
// that route), checked entirely inside the route, not here.
//
// /api/twilio/voice is the same shape: Twilio calls it directly with no
// browser session, and validates itself via the X-Twilio-Signature header
// (see that route and src/lib/live/twilioVoice.ts). /api/twilio/whisper is
// the same again -- Twilio requests it directly (as the Number noun's
// whisper `url`) once the customer leg answers, validated the same way.
//
// /api/live/segment has two callers: the browser (simulator mode, which
// keeps its normal staff session and is checked the same way inside that
// route) and scripts/live-bridge.mjs (Twilio mode's standalone bridge
// process, no browser session at all) — public here so the bridge can reach
// it, with the route itself requiring either a signed-in session or the
// x-live-bridge-secret header.
//
// /api/cron/brain-review is the same shape again: Vercel Cron calls it
// directly with no browser session (see vercel.json), gated inside the
// route by CRON_ENABLED (off by default) rather than a session.
//
// /api/cron/second-mile is the same shape again: Vercel Cron calls it
// directly with no browser session (see vercel.json), gated inside the
// route by CRON_ENABLED (off by default) rather than a session.
// /api/cron/weekly-digest is the same shape as /api/cron/brain-review:
// Vercel Cron calls it directly with no browser session, gated inside the
// route by CRON_ENABLED.
// /api/cron/score-calls is the same shape again: Vercel Cron calls it
// directly with no browser session (see vercel.json), gated inside the
// route by CRON_ENABLED (off by default) rather than a session.
// /api/cron/sync-recordings is the same shape once more: the nightly
// recordings sync (Workstream 1), also Vercel-Cron-called with no browser
// session, also gated by CRON_ENABLED.
//
// /forgot-password and /reset-password are auth pages like /login: a
// signed-out visitor must be able to reach them to recover their account,
// so they're exempted here the same way rather than redirected to /login
// in a loop.
const PUBLIC_AUTH_PATHS = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/api/health',
];

const MACHINE_PATHS = [
  '/api/webhooks/ghl',
  '/api/twilio/voice',
  '/api/twilio/whisper',
  '/api/live/segment',
  '/api/cron/brain-review',
  '/api/cron/second-mile',
  '/api/cron/weekly-digest',
  '/api/cron/score-calls',
  '/api/cron/sync-recordings',
];

function matchesPath(pathname: string, paths: readonly string[]): boolean {
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return paths.includes(normalizedPath);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (matchesPath(pathname, PUBLIC_AUTH_PATHS)) {
    return NextResponse.next();
  }

  const isApi = pathname.startsWith('/api/');
  const authConfiguration = resolveServerAuthConfiguration();
  if (!authConfiguration.ok) return authenticationUnavailable(isApi);

  // Machine callers do not have staff cookies, but configuration must be
  // valid before their route-specific authentication and persistence runs.
  if (matchesPath(pathname, MACHINE_PATHS)) return NextResponse.next();

  // Standard @supabase/ssr pattern: mirror refreshed auth cookies onto both
  // the forwarded request and the response.
  let response = NextResponse.next({ request });
  let userEmail: string | null | undefined;
  let hasUser = false;
  try {
    const supabase = createServerClient(authConfiguration.url, authConfiguration.anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error && !isSignedOutAuthError(error)) {
      return authenticationUnavailable(isApi, response);
    }
    hasUser = !!user;
    userEmail = user?.email;
  } catch (error) {
    if (isSignedOutAuthError(error)) {
      hasUser = false;
    } else {
      return authenticationUnavailable(isApi, response);
    }
  }

  if (!hasUser) {
    if (isApi) {
      return privateResponse(
        NextResponse.json({ error: 'Not signed in' }, { status: 401 }),
        response,
      );
    }
    return privateResponse(
      NextResponse.redirect(new URL('/login', request.url)),
      response,
    );
  }

  let decision: Awaited<ReturnType<typeof checkAllowlist>>;
  try {
    decision = await checkAllowlist(userEmail);
  } catch {
    return authenticationUnavailable(isApi, response);
  }
  // Both an explicit denial and an unavailable allowlist dependency must
  // deny; the latter receives a generic service-unavailable response.
  if (shouldDenyAccess(decision)) {
    if (decision === 'unconfigured') return authenticationUnavailable(isApi, response);
    if (isApi) {
      return privateResponse(
        NextResponse.json({ error: 'Not on the staff list' }, { status: 403 }),
        response,
      );
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('denied', '1');
    return privateResponse(NextResponse.redirect(loginUrl), response);
  }

  return response;
}

function privateResponse(target: NextResponse, cookieSource?: NextResponse): NextResponse {
  cookieSource?.cookies.getAll().forEach(cookie => target.cookies.set(cookie));
  target.headers.set('Cache-Control', 'no-store');
  target.headers.set('Vary', 'Cookie');
  return target;
}

const SIGNED_OUT_AUTH_ERROR_CODES = new Set([
  'bad_jwt',
  'refresh_token_already_used',
  'refresh_token_not_found',
  'session_expired',
  'session_not_found',
]);

function isSignedOutAuthError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const authError = error as { name?: unknown; code?: unknown };
  return (
    authError.name === 'AuthSessionMissingError' ||
    (typeof authError.code === 'string' && SIGNED_OUT_AUTH_ERROR_CODES.has(authError.code))
  );
}

function authenticationUnavailable(
  isApi: boolean,
  cookieSource?: NextResponse,
): NextResponse {
  const response = isApi
    ? NextResponse.json(
        {
          error: {
            code: 'AUTH_SERVICE_UNAVAILABLE',
            message: 'Authentication is temporarily unavailable.',
          },
        },
        { status: 503 },
      )
    : new NextResponse('Authentication is temporarily unavailable.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
  response.headers.set('Retry-After', '60');
  return privateResponse(response, cookieSource);
}

export const config = {
  // Exclude only Next internals and the one known public asset. A dynamic API
  // or page identifier ending in an image/font extension must still cross the
  // authorization boundary.
  matcher: ['/((?!_next/|favicon\\.ico$).*)'],
};
