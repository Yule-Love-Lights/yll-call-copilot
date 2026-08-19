import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const isSupabaseConfiguredMock = vi.fn();
const getSupabaseServerClientMock = vi.fn();
const isMissingTableErrorMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: (...args: unknown[]) => isSupabaseConfiguredMock(...args),
  getSupabaseServerClient: (...args: unknown[]) => getSupabaseServerClientMock(...args),
  isMissingTableError: (...args: unknown[]) => isMissingTableErrorMock(...args),
}));

const isClaudeConfiguredMock = vi.fn();
vi.mock('@/lib/claude', () => ({
  isClaudeConfigured: (...args: unknown[]) => isClaudeConfiguredMock(...args),
}));

const backfillCommitmentsMock = vi.fn();
vi.mock('@/lib/commitments/backfill', () => ({
  backfillCommitments: (...args: unknown[]) => backfillCommitmentsMock(...args),
}));

import { GET, isMissingCommitmentMigrationError } from './route';

const validRequest = () => new Request(
  'https://ops.example.com/api/cron/extract-commitments',
  { headers: { authorization: 'Bearer test-cron-secret-value' } },
);

describe('GET /api/cron/extract-commitments', () => {
  const originalCronEnabled = process.env.CRON_ENABLED;
  const originalCronSecret = process.env.CRON_SECRET;
  const supabase = { from: vi.fn(), rpc: vi.fn() };

  beforeEach(() => {
    process.env.CRON_ENABLED = 'true';
    process.env.CRON_SECRET = 'test-cron-secret-value';
    isSupabaseConfiguredMock.mockReset().mockReturnValue(true);
    isClaudeConfiguredMock.mockReset().mockReturnValue(true);
    isMissingTableErrorMock.mockReset().mockReturnValue(false);
    getSupabaseServerClientMock.mockReset().mockReturnValue(supabase);
    backfillCommitmentsMock.mockReset().mockResolvedValue({
      done: 2,
      skipped: 1,
      failed: 0,
      refused: 0,
      quarantined: 0,
    });
  });

  afterEach(() => {
    process.env.CRON_ENABLED = originalCronEnabled;
    process.env.CRON_SECRET = originalCronSecret;
  });

  it('rejects a missing or wrong cron credential before doing work', async () => {
    const missing = await GET(new Request('https://ops.example.com/api/cron/extract-commitments'));
    const wrong = await GET(new Request(
      'https://ops.example.com/api/cron/extract-commitments',
      { headers: { authorization: 'Bearer wrong-secret-value' } },
    ));

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(backfillCommitmentsMock).not.toHaveBeenCalled();
  });

  it('distinguishes missing server authentication from caller denial', async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(new Request('https://ops.example.com/api/cron/extract-commitments'));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'CRON_SECRET_UNCONFIGURED' });
    expect(backfillCommitmentsMock).not.toHaveBeenCalled();
  });

  it('honors the independent cron kill switch', async () => {
    process.env.CRON_ENABLED = 'false';
    const response = await GET(validRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ran: false, reason: 'CRON_ENABLED is not set.' });
    expect(backfillCommitmentsMock).not.toHaveBeenCalled();
  });

  it('requires both Supabase and Claude before starting the batch', async () => {
    isClaudeConfiguredMock.mockReturnValue(false);
    const response = await GET(validRequest());

    expect(await response.json()).toEqual({
      ran: false,
      reason: 'Supabase or Claude not configured.',
    });
    expect(backfillCommitmentsMock).not.toHaveBeenCalled();
  });

  it('runs one bounded performance-only commitment batch', async () => {
    const response = await GET(validRequest());

    expect(response.status).toBe(200);
    expect(backfillCommitmentsMock).toHaveBeenCalledWith(
      supabase,
      'Holiday Lighting',
      6,
    );
    expect(await response.json()).toEqual({
      ran: true,
      done: 2,
      skipped: 1,
      failed: 0,
      refused: 0,
      quarantined: 0,
    });
  });

  it.each(['42703', '42883', 'PGRST202', 'PGRST204'])(
    'recognizes missing 0024 database code %s',
    code => {
      expect(isMissingCommitmentMigrationError({ code })).toBe(true);
    },
  );

  it('reports a missing 0024 migration without claiming work ran', async () => {
    const migrationError = { code: 'PGRST204' };
    backfillCommitmentsMock.mockRejectedValue(migrationError);

    const response = await GET(validRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ran: false,
      migrated: false,
      reason: 'Run migrations through 0024 first.',
    });
  });

  it('returns a failing cron status while preserving durable batch counts', async () => {
    backfillCommitmentsMock.mockResolvedValue({
      done: 4,
      skipped: 0,
      failed: 1,
      refused: 0,
      quarantined: 1,
    });

    const response = await GET(validRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ran: true,
      done: 4,
      skipped: 0,
      failed: 1,
      refused: 0,
      quarantined: 1,
    });
  });

  it('fails visibly when the batch loader cannot run', async () => {
    backfillCommitmentsMock.mockRejectedValue(new Error('database unavailable'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET(validRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ran: false,
      reason: 'Commitment extraction failed.',
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
