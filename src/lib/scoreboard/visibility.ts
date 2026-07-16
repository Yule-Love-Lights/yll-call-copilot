// Pure visibility rules for the scoreboard (docs/SALES-EXCELLENCE-PLAN.md
// "Visibility: full transparency, made safe by four rules" + the two-week
// private onboarding rollout). No I/O — GET /api/scoreboard resolves the
// signed-in email + role + coach_settings row, then calls these.

export type BoardScope = 'own' | 'all';

// 'rep' is the only role that ever gets narrowed to its own row — every
// other role (owner, admin, whatever app_users.role holds) sees the whole
// board once it's team-visible, and always sees everything even during
// onboarding (they're the one running the rollout). A role we can't resolve
// (query failed, email not found) fails to the more private option, same
// "fail closed" convention as src/lib/auth/allowlist.ts's checkAllowlist.
export function resolveBoardScope(role: string | null, teamBoardEnabled: boolean): BoardScope {
  if (teamBoardEnabled) return 'all';
  const isKnownNonRep = role !== null && role !== 'rep';
  return isKnownNonRep ? 'all' : 'own';
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
