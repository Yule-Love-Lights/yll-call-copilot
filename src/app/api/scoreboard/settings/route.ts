// POST /api/scoreboard/settings — body {team_board_enabled: boolean}.
// Non-rep role only (owner/admin/whatever app_users.role holds besides
// 'rep') — a rep can never flip the team-visibility switch. An unresolved
// role (no app_users match, or a lookup failure) is denied, fail-closed,
// same convention as src/lib/auth/allowlist.ts.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';
import { resolveRepRole } from '@/lib/scoreboard/role';
import { setTeamBoardEnabled } from '@/lib/scoreboard/settings';

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, updated: false, reason: 'Supabase not configured.' });
  }

  const body = await request.json().catch(() => null);
  const enabled = body?.team_board_enabled;
  if (typeof enabled !== 'boolean') {
    return NextResponse.json({ configured: true, updated: false, reason: 'team_board_enabled must be a boolean.' }, { status: 400 });
  }

  const supabase = getSupabaseServerClient()!;
  const sessionEmail = await getSessionEmail();
  const role = await resolveRepRole(sessionEmail, supabase);
  if (role === null || role === 'rep') {
    return NextResponse.json(
      { configured: true, updated: false, reason: 'Only a non-rep role can change scoreboard visibility.' },
      { status: 403 },
    );
  }

  const result = await setTeamBoardEnabled(supabase, enabled, new Date());
  if (!result.ok) {
    return NextResponse.json({ configured: true, updated: false, reason: 'Run migration 0011 first.' });
  }

  return NextResponse.json({ configured: true, updated: true, settings: result.settings });
}
