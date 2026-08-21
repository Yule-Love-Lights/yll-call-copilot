// Central request authorization boundary. Every app page and route method is
// declared in routePolicy.ts. Unknown paths/methods deny by default. Employee
// requests resolve one immutable Hub actor and require explicit capabilities;
// webhook/cron/Twilio callers proceed only to their route-local authentication.

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { resolveHubActor, type AuthenticatedUserIdentity } from '@/lib/auth/actor';
import { resolveIdentityAuthConfiguration } from '@/lib/auth/config';
import {
  isHubSessionWithinMaximumAge,
  isVerifiedPhoneOtpSession,
  resolvePhoneAuthConfiguration,
} from '@/lib/auth/phoneAuth';
import { auditSensitiveRouteAccess } from '@/lib/auth/resource';
import {
  actorMeetsRouteRequirement,
  isPublicRuntimeAsset,
  resolveRoutePolicy,
} from '@/lib/auth/routePolicy';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicRuntimeAsset(pathname)) return NextResponse.next();
  const routePolicy = resolveRoutePolicy(pathname, request.method);

  if (routePolicy?.requirement.kind === 'public') {
    return NextResponse.next();
  }

  const isApi = pathname.startsWith('/api/');
  const authConfiguration = resolveIdentityAuthConfiguration();
  if (!authConfiguration.ok) return authenticationUnavailable(isApi);
  const phoneAuthConfiguration = resolvePhoneAuthConfiguration();
  if (phoneAuthConfiguration.mode === 'unavailable') return authenticationUnavailable(isApi);

  // Undeclared paths and methods never inherit access from a neighboring route.
  if (!routePolicy) return authorizationDenied(isApi);

  // Machine callers do not have employee cookies. Configuration must still be
  // valid before their endpoint-specific authentication and persistence run.
  if (routePolicy.requirement.kind === 'route_authenticated') {
    return NextResponse.next();
  }

  // Standard @supabase/ssr pattern: mirror refreshed auth cookies onto both
  // the forwarded request and the response. Strip actor-like inbound headers;
  // downstream code must resolve an actor rather than trust caller input.
  const forwardedHeaders = new Headers(request.headers);
  for (const header of [...forwardedHeaders.keys()]) {
    if (header.toLowerCase().startsWith('x-yll-actor-')) forwardedHeaders.delete(header);
  }
  let response = NextResponse.next({ request: { headers: forwardedHeaders } });
  let authenticatedUser: AuthenticatedUserIdentity | null = null;
  try {
    const supabase = createServerClient(authConfiguration.url, authConfiguration.anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          forwardedHeaders.set('cookie', request.cookies.toString());
          response = NextResponse.next({ request: { headers: forwardedHeaders } });
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
    let phoneSessionAccepted = true;
    if (user && phoneAuthConfiguration.mode === 'enabled') {
      const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
      if (claimsError || !claimsData) return authenticationUnavailable(isApi, response);
      phoneSessionAccepted =
        isVerifiedPhoneOtpSession(claimsData.claims, user) &&
        isHubSessionWithinMaximumAge(claimsData.claims);
    }
    if (user && !phoneSessionAccepted) {
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        // The verified session is denied below even if Supabase cannot clear
        // it. No actor or protected route is reached after the 30-day limit.
      }
      authenticatedUser = null;
    } else {
      authenticatedUser = user;
    }
  } catch (error) {
    if (isSignedOutAuthError(error)) {
      authenticatedUser = null;
    } else {
      return authenticationUnavailable(isApi, response);
    }
  }

  if (!authenticatedUser) {
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

  let actorResolution: Awaited<ReturnType<typeof resolveHubActor>>;
  try {
    actorResolution = await resolveHubActor({
      ...authenticatedUser,
      identitySource: authConfiguration.source,
    });
  } catch {
    return authenticationUnavailable(isApi, response);
  }
  if (actorResolution.status === 'unavailable') {
    return authenticationUnavailable(isApi, response);
  }
  if (actorResolution.status === 'denied') {
    return authorizationDenied(isApi, response);
  }
  if (!actorMeetsRouteRequirement(actorResolution.actor, routePolicy.requirement)) {
    return authorizationDenied(isApi, response);
  }
  if (
    routePolicy.requirement.auditBeforeFieldLaunch &&
    actorResolution.actor.role === 'owner_admin' &&
    !(await auditSensitiveRouteAccess({
      actor: actorResolution.actor,
      method: routePolicy.method,
      routeTemplate: routePolicy.template,
    }))
  ) {
    return authenticationUnavailable(isApi, response);
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

function authorizationDenied(
  isApi: boolean,
  cookieSource?: NextResponse,
): NextResponse {
  const response = isApi
    ? NextResponse.json(
        {
          error: {
            code: 'ACCESS_DENIED',
            message: 'You do not have access to this resource.',
          },
        },
        { status: 403 },
      )
    : new NextResponse('You do not have access to this resource.', {
        status: 403,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
  return privateResponse(response, cookieSource);
}

export const config = {
  // Exclude only Next internals. Public runtime assets pass through the exact
  // registry above; dotted dynamic identifiers still cross authorization.
  matcher: ['/((?!_next/).*)'],
};
