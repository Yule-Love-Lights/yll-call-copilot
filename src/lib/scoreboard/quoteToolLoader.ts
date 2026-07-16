// I/O for reading the AI Quote Tool's `quotes` table (via
// src/lib/quoteTool.ts's read-only client) and reshaping rows for
// quoteToClose.ts and flywheel.ts's rebook math. Thin — the math is unit
// tested in those two files; this is only the fetch + mapping.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { QuoteToCloseRow } from './quoteToClose';
import type { RebookQuoteRow } from './flywheel';

type RawQuoteRow = {
  quote_sent_at: string | null;
  customer_approved_at: string | null;
  service_type: string | null;
  is_test: boolean;
  customer_phone: string | null;
  customer_email: string | null;
};

export type LoadQuoteToolRowsResult = { ok: true; rows: RawQuoteRow[] } | { ok: false; reason: string };

export async function loadQuoteToolRows(client: SupabaseClient): Promise<LoadQuoteToolRowsResult> {
  const { data, error } = await client
    .from('quotes')
    .select('quote_sent_at, customer_approved_at, service_type, is_test, customer_phone, customer_email');
  if (error) {
    console.error('Load quotes from the Quote Tool DB failed:', error);
    return { ok: false, reason: 'Could not read the Quote Tool database.' };
  }
  return { ok: true, rows: (data ?? []) as RawQuoteRow[] };
}

export function toQuoteToCloseRows(rows: RawQuoteRow[]): QuoteToCloseRow[] {
  return rows.map(r => ({
    sentAt: r.quote_sent_at,
    approvedAt: r.customer_approved_at,
    vertical: r.service_type,
    isTest: r.is_test,
  }));
}

// Holiday only (rebook is a holiday-season mechanic) and only approved rows
// count as "a customer" — a quote that was sent but never approved never
// became a relationship to rebook.
export function toRebookRows(rows: RawQuoteRow[]): RebookQuoteRow[] {
  return rows
    .filter(r => (r.service_type ?? 'holiday') === 'holiday' && !!r.customer_approved_at)
    .map(r => ({
      phone: r.customer_phone,
      email: r.customer_email,
      approvedAt: r.customer_approved_at as string,
      isTest: r.is_test,
    }));
}
