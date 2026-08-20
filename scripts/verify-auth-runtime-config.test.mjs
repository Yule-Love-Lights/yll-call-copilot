import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('./verify-auth-runtime-config.mjs', import.meta.url));
const baseline = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  HUB_OWNER_ADMIN_AUTH_USER_IDS:
    '123e4567-e89b-42d3-a456-426614174000,223e4567-e89b-42d3-a456-426614174000',
  CRON_SECRET: '0123456789abcdef',
  GHL_WEBHOOK_SECRET: '',
  GHL_FOLLOWUP_SEND_ENABLED: 'false',
  HUB_PHONE_AUTH_STAGING_ENABLED: 'false',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: '',
  VERCEL_ENV: 'production',
  VERCEL_GIT_COMMIT_REF: 'master',
  LIVE_BRIDGE_SECRET: '',
  LIVE_BRIDGE_URL: '',
  LIVE_APP_BASE_URL: '',
  TWILIO_ACCOUNT_SID: '',
  TWILIO_API_KEY_SID: '',
  TWILIO_API_KEY_SECRET: '',
  TWILIO_AUTH_TOKEN: '',
  TWILIO_TWIML_APP_SID: '',
  TWILIO_CALLER_ID: '',
};

function run(overrides = {}) {
  return spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, ...baseline, ...overrides },
  });
}

describe('authorization runtime preflight', () => {
  it('accepts a complete least-privilege baseline without printing values', () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('AUTH_RUNTIME_CONFIG_OK');
  });

  it('rejects whitespace-padded secrets exactly as runtime authentication does', () => {
    const result = run({ CRON_SECRET: ' 0123456789abcdef ' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('CRON_SECRET must be an unpadded secret');
  });

  it('keeps customer follow-up sending disabled until reconciliation is implemented', () => {
    const result = run({ GHL_FOLLOWUP_SEND_ENABLED: 'true' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('GHL_FOLLOWUP_SEND_ENABLED must remain false');
  });

  it('rejects the same Owner/Admin UUID twice even when hex casing differs', () => {
    const result = run({
      HUB_OWNER_ADMIN_AUTH_USER_IDS:
        '123e4567-e89b-42d3-a456-426614174000,123E4567-E89B-42D3-A456-426614174000',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('exactly two unique Supabase Auth UUIDs');
  });

  it('requires an exact activation flag and Turnstile site key for staging phone auth', () => {
    const malformed = run({ HUB_PHONE_AUTH_STAGING_ENABLED: 'yes' });
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain('must be exactly true or false');

    const missingTurnstile = run({ HUB_PHONE_AUTH_STAGING_ENABLED: 'true' });
    expect(missingTurnstile.status).toBe(1);
    expect(missingTurnstile.stderr).toContain('NEXT_PUBLIC_TURNSTILE_SITE_KEY is required');

    const configured = run({
      HUB_PHONE_AUTH_STAGING_ENABLED: 'true',
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'public-site-key',
      VERCEL_ENV: 'preview',
      VERCEL_GIT_COMMIT_REF: 'staging',
    });
    expect(configured.status).toBe(0);

    const production = run({
      HUB_PHONE_AUTH_STAGING_ENABLED: 'true',
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'public-site-key',
      VERCEL_ENV: 'production',
      VERCEL_GIT_COMMIT_REF: 'staging',
    });
    expect(production.status).toBe(1);
    expect(production.stderr).toContain('only when VERCEL_ENV is preview');

    const wrongBranch = run({
      HUB_PHONE_AUTH_STAGING_ENABLED: 'true',
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'public-site-key',
      VERCEL_ENV: 'preview',
      VERCEL_GIT_COMMIT_REF: 'feature-branch',
    });
    expect(wrongBranch.status).toBe(1);
    expect(wrongBranch.stderr).toContain('only on the staging branch');
  });
});
