// Anthropic (Claude) client factory. Ported verbatim from the AI Quote
// Tool's src/lib/claude.ts, already proven in prod. isClaudeConfigured() lets
// the rest of the app degrade gracefully — same convention as
// isHighLevelConfigured() / isSupabaseConfigured().

import Anthropic from '@anthropic-ai/sdk';

export function getClaudeClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

export function isClaudeConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
