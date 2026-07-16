// GET /api/scoreboard — the transparency scoreboard + the two wall metrics.
// Visibility (docs/SALES-EXCELLENCE-PLAN.md's four locked rules): while
// team_board_enabled is false (the two-week private onboarding), a 'rep'
// role sees only their own row; every other role always sees the whole
// board. The two wall metrics (quote-to-close, the experience flywheel) are
// company-level, not per-rep, so they render for every viewer regardless of
// scope.

import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';
import { resolveRepRole } from '@/lib/scoreboard/role';
import { loadCoachSettings } from '@/lib/scoreboard/settings';
import { loadCallScores } from '@/lib/scoreboard/loader';
import { buildScoreboard, buildRepStat } from '@/lib/scoreboard/stats';
import { resolveBoardScope, isOnboardingPromptDue } from '@/lib/scoreboard/visibility';
import { isQuoteToolConfigured, getQuoteToolClient } from '@/lib/quoteTool';
import { loadQuoteToolRows, toQuoteToCloseRows, toRebookRows } from '@/lib/scoreboard/quoteToolLoader';
import { buildQuoteToCloseSummary, type QuoteToCloseSummary } from '@/lib/scoreboard/quoteToClose';
import { referralVolumeMetric, newFiveStarReviewsMetric, rebookRateMetric, type FlywheelSubMetric } from '@/lib/scoreboard/flywheel';

type WallMetrics = {
  quoteToClose: QuoteToCloseSummary | null;
  quoteToCloseReason?: string;
  flywheel: { referralVolume: FlywheelSubMetric; rebookRate: FlywheelSubMetric; newFiveStarReviews: FlywheelSubMetric };
};

// The Quote Tool DB connection needed for both the quote-to-close tile and
// the rebook-rate leg of the flywheel — one degrade reason serves both when
// it's missing, same "one config gate, several dependent features" shape as
// isSupabaseConfigured() gating every Supabase-backed route in this app.
async function loadWallMetrics(asOf: Date): Promise<WallMetrics> {
  const notConnectedReason = !isQuoteToolConfigured()
    ? 'Set QUOTE_TOOL_SUPABASE_URL and QUOTE_TOOL_SUPABASE_SERVICE_ROLE_KEY to read the Quote Tool database.'
    : null;

  if (notConnectedReason) {
    return {
      quoteToClose: null,
      quoteToCloseReason: notConnectedReason,
      flywheel: {
        referralVolume: referralVolumeMetric(),
        rebookRate: { status: 'not_connected', label: 'Rebook rate', reason: notConnectedReason },
        newFiveStarReviews: newFiveStarReviewsMetric(),
      },
    };
  }

  const client = getQuoteToolClient()!;
  const rowsResult = await loadQuoteToolRows(client);
  if (!rowsResult.ok) {
    return {
      quoteToClose: null,
      quoteToCloseReason: rowsResult.reason,
      flywheel: {
        referralVolume: referralVolumeMetric(),
        rebookRate: { status: 'not_connected', label: 'Rebook rate', reason: rowsResult.reason },
        newFiveStarReviews: newFiveStarReviewsMetric(),
      },
    };
  }

  return {
    quoteToClose: buildQuoteToCloseSummary(toQuoteToCloseRows(rowsResult.rows), asOf),
    flywheel: {
      referralVolume: referralVolumeMetric(),
      rebookRate: rebookRateMetric(toRebookRows(rowsResult.rows), asOf),
      newFiveStarReviews: newFiveStarReviewsMetric(),
    },
  };
}

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const asOf = new Date();
  const supabase = getSupabaseServerClient()!;

  const settingsResult = await loadCoachSettings(supabase);
  if (!settingsResult.ok) {
    return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0011 first.' });
  }
  const { teamBoardEnabled, onboardingStartedAt } = settingsResult.settings;

  const sessionEmail = await getSessionEmail();
  const role = await resolveRepRole(sessionEmail, supabase);
  const scope = resolveBoardScope(role, teamBoardEnabled);
  // Whether this viewer can toggle team_board_enabled — same non-rep gate
  // POST /api/scoreboard/settings enforces, exposed here so the UI knows
  // whether to render the settings control at all.
  const canManageSettings = role !== null && role !== 'rep';

  const wallMetrics = await loadWallMetrics(asOf);

  if (scope === 'own') {
    if (!sessionEmail) {
      return NextResponse.json({ configured: true, error: 'Not signed in.' }, { status: 401 });
    }
    const rowsResult = await loadCallScores(supabase, { repEmail: sessionEmail });
    if (!rowsResult.ok) {
      return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0008 first.' });
    }
    return NextResponse.json({
      configured: true,
      scope,
      teamBoardEnabled,
      canManageSettings,
      own: buildRepStat(sessionEmail, rowsResult.rows, asOf),
      wallMetrics,
    });
  }

  const rowsResult = await loadCallScores(supabase);
  if (!rowsResult.ok) {
    return NextResponse.json({ configured: true, migrated: false, reason: 'Run migration 0008 first.' });
  }

  return NextResponse.json({
    configured: true,
    scope,
    teamBoardEnabled,
    canManageSettings,
    onboardingPromptDue: canManageSettings && isOnboardingPromptDue(onboardingStartedAt, teamBoardEnabled, asOf),
    board: buildScoreboard(rowsResult.rows, asOf),
    wallMetrics,
  });
}
