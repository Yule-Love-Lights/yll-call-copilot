import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { actorResolutionStatus, resolveCurrentHubActor } from '@/lib/auth/resource';
import { hasCapability } from '@/lib/auth/capabilities';
import { getSupabaseServerClient } from '@/lib/supabase';
import { readIdempotencyKey } from '@/app/api/tasks/taskRequest';

const MAX_QUOTE_TOOL_USER_PAGES = 100;
const QUOTE_TOOL_USERS_PER_PAGE = 1_000;
const MAX_REASON_LENGTH = 1_000;

function configured(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || null;
}

function isConfirmedUnbannedUser(user: {
  email_confirmed_at?: string | null;
  banned_until?: string | null;
}) {
  if (!user.email_confirmed_at) return false;
  if (!user.banned_until) return true;
  const bannedUntil = Date.parse(user.banned_until);
  return Number.isFinite(bannedUntil) && bannedUntil <= Date.now();
}

async function findConfirmedQuoteToolUser(
  listUsers: (input: { page: number; perPage: number }) => Promise<{
    data: { users: Array<{ id: string; email?: string | null; email_confirmed_at?: string | null; banned_until?: string | null }> };
    error: unknown;
  }>,
  email: string,
) {
  const matches = [] as Array<{ id: string }>;
  for (let page = 1; page <= MAX_QUOTE_TOOL_USER_PAGES; page += 1) {
    const { data, error } = await listUsers({
      page,
      perPage: QUOTE_TOOL_USERS_PER_PAGE,
    });
    if (error) return null;
    matches.push(...data.users.filter(user =>
      user.email?.trim().toLowerCase() === email
      && isConfirmedUnbannedUser(user),
    ));
    if (matches.length > 1 || data.users.length < QUOTE_TOOL_USERS_PER_PAGE) break;
  }
  return matches.length === 1 ? matches[0] : null;
}

export async function POST(request: NextRequest) {
  const resolution = await resolveCurrentHubActor();
  const status = actorResolutionStatus(resolution);
  if (status || resolution.status !== 'resolved' || !hasCapability(resolution.actor, 'operations.admin')) {
    return NextResponse.json({ code: 'IDENTITY_LINK_DENIED' }, { status: status ?? 403 });
  }
  const idempotencyKey = readIdempotencyKey(request);
  if (!idempotencyKey) return NextResponse.json({ code: 'IDENTITY_LINK_INVALID' }, { status: 400 });
  const body = await request.json().catch(() => null) as { email?: unknown; reason?: unknown } | null;
  if (!body || typeof body.email !== 'string' || typeof body.reason !== 'string') {
    return NextResponse.json({ code: 'IDENTITY_LINK_INVALID' }, { status: 400 });
  }
  const email = body.email.trim().toLowerCase();
  const reason = body.reason.trim();
  if (!email || !email.includes('@') || !reason || reason.length > MAX_REASON_LENGTH) {
    return NextResponse.json({ code: 'IDENTITY_LINK_INVALID' }, { status: 400 });
  }
  const hub = getSupabaseServerClient();
  const quoteUrl = configured(process.env.QUOTE_TOOL_SUPABASE_URL);
  const quoteKey = configured(process.env.QUOTE_TOOL_SUPABASE_SERVICE_ROLE_KEY);
  if (!hub || !quoteUrl || !quoteKey) return NextResponse.json({ code: 'IDENTITY_LINK_UNAVAILABLE' }, { status: 503 });
  const quote = createClient(quoteUrl, quoteKey, { auth: { persistSession: false } });
  const quoteUser = await findConfirmedQuoteToolUser(quote.auth.admin.listUsers, email);
  if (!quoteUser) return NextResponse.json({ code: 'IDENTITY_LINK_UNCONFIRMED' }, { status: 409 });
  const { data: employees, error: employeeError } = await hub
    .from('ops_employees').select('id').eq('compatibility_email', email).eq('active', true).limit(2);
  if (employeeError || (employees ?? []).length !== 1) return NextResponse.json({ code: 'IDENTITY_LINK_UNCONFIRMED' }, { status: 409 });
  const { error } = await hub.rpc('owner_link_quote_tool_employee_identity', {
    p_actor_employee_id: resolution.actor.employeeId,
    p_employee_id: employees![0].id,
    p_quote_tool_auth_user_id: quoteUser.id,
    p_reason: reason,
    p_idempotency_key: idempotencyKey,
  });
  if (error) return NextResponse.json({ code: 'IDENTITY_LINK_REJECTED' }, { status: error.code === '42501' ? 403 : 409 });
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
