// Pure visibility rules for the scoreboard (docs/SALES-EXCELLENCE-PLAN.md
// "Visibility: full transparency, made safe by four rules" + the two-week
// private onboarding rollout). No I/O — GET /api/scoreboard resolves the
// signed-in email + role + coach_settings row, then calls these.

export type BoardScope = 'own' | 'all';
export type BoardViewerRole = 'rep' | 'owner' | 'admin';

// Only a resolved closed role participates in team visibility. An unresolved,
// field, Manager, or arbitrary role remains own-only even when the board flag
// is enabled; the proxy separately denies non-Office actors from this route.
export function resolveBoardScope(role: BoardViewerRole | null, teamBoardEnabled: boolean): BoardScope {
  if (role !== 'rep' && role !== 'owner' && role !== 'admin') return 'own';
  if (teamBoardEnabled) return 'all';
  return role === 'owner' || role === 'admin' ? 'all' : 'own';
}

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

// A gentle nudge, never automatic (the plan's rollout protocol: "two-week
// private self-review... then team visibility", surfaced as a suggestion to
// the owner). True only while the board is STILL private and the current
// onboarding period has run 14+ days.
export function isOnboardingPromptDue(onboardingStartedAt: string | null, teamBoardEnabled: boolean, asOf: Date): boolean {
  if (teamBoardEnabled) return false;
  if (!onboardingStartedAt) return false;
  const startedMs = new Date(`${onboardingStartedAt}T00:00:00.000Z`).getTime();
  if (Number.isNaN(startedMs)) return false;
  return asOf.getTime() - startedMs >= FOURTEEN_DAYS_MS;
}
