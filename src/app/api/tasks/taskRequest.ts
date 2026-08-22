import { NextRequest, NextResponse } from 'next/server';
import { isMissingTableError } from '@/lib/supabase';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function readIdempotencyKey(request: NextRequest): string | null {
  const value = request.headers.get('x-idempotency-key')?.trim() ?? '';
  return isUuid(value) ? value : null;
}

export function databaseErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export function isTaskSchemaUnavailable(error: unknown): boolean {
  const code = databaseErrorCode(error);
  return isMissingTableError(error) || code === '42883' || code === 'PGRST202';
}

export function taskError(
  code: string,
  message: string,
  status: number,
  options?: { retryAfter?: number },
) {
  const response = NextResponse.json({ error: { code, message } }, { status });
  response.headers.set('Cache-Control', 'no-store');
  if (options?.retryAfter) response.headers.set('Retry-After', String(options.retryAfter));
  return response;
}
