// Shared authorization check for the five public cron routes (src/app/api/
// cron/*/route.ts). CRON_SECRET is optional and additive to CRON_ENABLED:
// CRON_ENABLED still gates whether a route does any work at all; this only
// decides whether the caller is allowed to ask. Unset/empty CRON_SECRET
// keeps today's soft posture (anyone who knows the path can hit it, same as
// before this file existed) so nothing breaks before the env var is set.
// Once set, Vercel Cron's own invocations already send
// `Authorization: Bearer <CRON_SECRET>` automatically (Vercel adds this
// header to every cron-triggered request when the project has a CRON_SECRET
// env var), so setting the var alone locks the routes down with no other
// config change.

export function isCronRequestAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;

  const provided = request.headers.get('authorization');
  return provided === `Bearer ${secret}`;
}
