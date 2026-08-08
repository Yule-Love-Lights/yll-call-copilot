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
});
