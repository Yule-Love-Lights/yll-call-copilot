// GET /api/cron/extract-commitments processes a bounded set of real,
// performance-scoped transcripts into rep action items. Migration 0024 owns
// the durable completion marker, including valid zero-result extractions, so
// hourly retries are idempotent and older transcripts cannot starve.

import { NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/auth/machine';
import { isClaudeConfigured } from '@/lib/claude';
import { backfillCommitments } from '@/lib/commitments/backfill';
import {
  getSupabaseServerClient,
  isMissingTableError,
  isSupabaseConfigured,
} from '@/lib/supabase';

export const maxDuration = 300;

const BATCH_LIMIT = 6;
const DEFAULT_VERTICAL_NAME = 'Holiday Lighting';
const MISSING_COMMITMENT_MIGRATION_CODES = new Set([
  '42703',
  '42883',
  'PGRST202',
  'PGRST204',
]);

export function isMissingCommitmentMigrationError(error: unknown): boolean {
  if (isMissingTableError(error)) return true;
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && MISSING_COMMITMENT_MIGRATION_CODES.has(code);
}

export async function GET(request: Request) {
  const auth = verifyCronRequest(request);
  if (auth !== 'authorized') {
    return auth === 'unconfigured'
      ? NextResponse.json(
          {
            error: 'CRON_SECRET is not configured',
            code: 'CRON_SECRET_UNCONFIGURED',
            hint: 'Set CRON_SECRET (16+ chars) in this environment; every cron caller is rejected until then.',
          },
          { status: 503 },
        )
      : NextResponse.json(
          { error: 'Unauthorized', code: 'CRON_AUTH_DENIED' },
          { status: 401 },
        );
  }
  if (process.env.CRON_ENABLED !== 'true') {
    return NextResponse.json({ ran: false, reason: 'CRON_ENABLED is not set.' });
  }
  if (!isSupabaseConfigured() || !isClaudeConfigured()) {
    return NextResponse.json({ ran: false, reason: 'Supabase or Claude not configured.' });
  }

  const supabase = getSupabaseServerClient()!;
  try {
    const result = await backfillCommitments(
      supabase,
      DEFAULT_VERTICAL_NAME,
      BATCH_LIMIT,
    );
    return NextResponse.json(
      { ran: true, ...result },
      { status: result.failed > 0 ? 500 : 200 },
    );
  } catch (error) {
    if (isMissingCommitmentMigrationError(error)) {
      return NextResponse.json({
        ran: false,
        migrated: false,
        reason: 'Run migrations through 0024 first.',
      });
    }
    console.error('Cron commitment extraction failed:', error);
    return NextResponse.json(
      { ran: false, reason: 'Commitment extraction failed.' },
      { status: 500 },
    );
  }
}
