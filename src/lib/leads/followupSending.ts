// Customer follow-up delivery is not activated in Phase 0. Keeping this as a
// checked-in positive gate means a stale or accidentally enabled environment
// variable cannot reach the provider route. Tests may mock this function to
// exercise the future state machine without weakening production behavior.
export function isFollowupSendingActivated(): boolean {
  return false;
}
