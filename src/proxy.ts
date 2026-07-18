// Staff-only gate for every route. Next 16 renamed the middleware file
// convention to proxy (and with the src/ layout it lives here, next to app/).
// Flow: refresh the Supabase session from cookies, require a signed-in user,
// then require that user's email to be in app_users (the staff allowlist).
// Pages redirect to /login; API routes get JSON errors. Missing Supabase env
// lets everything through — dev degradation, same philosophy as the rest of
// the app.

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { checkAllowlist, shouldDenyAccess } from '@/lib/auth/allowlist';

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
const PUBLIC_PATHS = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/api/health',
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

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.next();

  // Standard @supabase/ssr pattern: mirror refreshed auth cookies onto both
  // the forwarded request and the response.
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
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
  } = await supabase.auth.getUser();
  const isApi = pathname.startsWith('/api/');

  if (!user) {
    if (isApi) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const decision = await checkAllowlist(user.email);
  // Both an explicit denial AND an unusable allowlist check (service-role
  // key missing/wrong, or the query itself errored) must deny — see
  // shouldDenyAccess's own comment for why 'unconfigured' can't mean "let
  // them through" at this point in the flow.
  if (shouldDenyAccess(decision)) {
    if (isApi) {
      return NextResponse.json(
        { error: decision === 'unconfigured' ? 'Staff allowlist is not configured.' : 'Not on the staff list' },
        { status: 403 },
      );
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('denied', '1');
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Everything except Next internals and known static assets: favicon.ico
  // and a conservative image/font extension allowlist anchored to the END
  // of the path. NOT "any path containing a dot anywhere" — that excluded
  // every dynamic-id route (/call/[leadId], /api/leads/[id], etc.) from auth
  // entirely whenever the id itself happened to contain a dot, since a dot
  // can appear inside a route param, not just a file extension. /login and
  // /api/health are exempted in code above so this stays one simple pattern,
  // the same shape as the official @supabase/ssr Next.js middleware example.
  matcher: ['/((?!_next/|favicon\\.ico$|.*\\.(?:ico|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|eot)$).*)'],
};
