// Read-only Supabase client for the AI Quote Tool's database (a separate
// Supabase project from this app's own). Used to label call outcomes and
// compute quote-to-close from the quotes the team actually sent. By
// convention every consumer is SELECT-only: this app never writes to the
// quote tool's tables. Degrades gracefully when unconfigured, same
// convention as isSupabaseConfigured() / isHighLevelConfigured().

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function isQuoteToolConfigured(): boolean {
  return !!(process.env.QUOTE_TOOL_SUPABASE_URL && process.env.QUOTE_TOOL_SUPABASE_SERVICE_ROLE_KEY);
}

export function getQuoteToolClient(): SupabaseClient | null {
  const url = process.env.QUOTE_TOOL_SUPABASE_URL;
  const key = process.env.QUOTE_TOOL_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}
