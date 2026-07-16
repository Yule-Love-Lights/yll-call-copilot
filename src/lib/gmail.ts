// Gmail adapter seam for Workstream 6 (fast on-brand email replies).
// isGmailConfigured() lets POST /api/inbox/check (the fallback + Gmail poll)
// degrade gracefully -- same convention as isHighLevelConfigured() /
// isSupabaseConfigured() / isClaudeConfigured(). No Gmail OAuth creds exist
// yet (that decision is Naldo's, see this workstream's PR body), so
// fetchRecentInboundEmails() is a documented stub that always returns []
// until GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN are set
// AND the real OAuth + Gmail API wiring lands as a follow-up. The source
// enum ('gmail', see src/lib/email/types.ts) and this call site already
// exist so that follow-up is a pure fill-in, not a shape change.

export type FetchedInboundEmail = {
  sourceMessageId: string;
  fromAddress: string | null;
  fromName: string | null;
  subject: string | null;
  body: string;
  receivedAt: string | null;
};

export function isGmailConfigured(): boolean {
  return !!(
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    process.env.GMAIL_REFRESH_TOKEN
  );
}

// Stub: real OAuth + Gmail API (users.messages.list / .get, filtered to
// unread inbound mail) is a follow-up. Always returns [] for now -- callers
// (POST /api/inbox/check) already treat an empty result as "nothing new"
// rather than an error, so this is a safe no-op until the follow-up lands.
export async function fetchRecentInboundEmails(): Promise<FetchedInboundEmail[]> {
  if (!isGmailConfigured()) return [];
  return [];
}
