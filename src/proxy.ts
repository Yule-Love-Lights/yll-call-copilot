// Staff-only gate for every route. Next 16 renamed the middleware file
// convention to proxy (and with the src/ layout it lives here, next to app/).
// Flow: refresh the Supabase session from cookies, require a signed-in user,
// then require that user's email to be in app_users (the staff allowlist).
// Pages redirect to /login; API routes get JSON errors. Missing Supabase env
// lets everything through — dev degradation, same philosophy as the rest of
// the app.

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { checkAllowlist } from '@/lib/auth/allowlist';

// /api/webhooks/ghl has no user session (GoHighLevel calls it directly) —
// it authenticates itself with a shared-secret query param instead (see
// that route), checked entirely inside the route, not here.
//
// /api/twilio/voice is the same shape: Twilio calls it directly with no
// browser session, and validates itself via the X-Twilio-Signature header
// (see that route and src/lib/live/twilioVoice.ts).
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
const PUBLIC_PATHS = [
  '/login',
  '/api/health',
  '/api/webhooks/ghl',
  '/api/twilio/voice',
  '/api/live/segment',
  '/api/cron/brain-review',
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
  if (decision === 'denied') {
    if (isApi) {
      return NextResponse.json({ error: 'Not on the staff list' }, { status: 403 });
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('denied', '1');
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Everything except Next internals and static assets (any path with a file
  // extension, which covers /favicon.ico and public/ files). /login and
  // /api/health are exempted in code above so this stays one simple pattern.
  matcher: ['/((?!_next/|.*\\..*).*)'],
};
