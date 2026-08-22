import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('./verify-auth-runtime-config.mjs', import.meta.url));
const hubProjectUrl = 'https://mjmociuxxxwxvasnpxav.supabase.co';
const stagingHubProjectUrl = 'https://ewbtkrytrnerypdkuimd.supabase.co';
const quoteProjectUrl = 'https://chhntsbnbofyqrpivuog.supabase.co';
const publishableKey = 'sb_publishable_1234567890abcdefghij';

function legacyKey(role) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role })}.signature`;
}

const baseline = {
  NEXT_PUBLIC_SUPABASE_URL: hubProjectUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: publishableKey,
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE: 'hub',
  NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL: '',
  NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY: '',
  HUB_OWNER_ADMIN_AUTH_USER_IDS:
    '123e4567-e89b-42d3-a456-426614174000,223e4567-e89b-42d3-a456-426614174000',
  CRON_SECRET: '0123456789abcdef',
  GHL_WEBHOOK_SECRET: '',
  GHL_FOLLOWUP_SEND_ENABLED: 'false',
  GHL_SEND_ENABLED: 'false',
  CRON_ENABLED: 'false',
  HUB_PHONE_AUTH_STAGING_ENABLED: 'false',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: '',
  VERCEL_ENV: 'production',
  LIVE_BRIDGE_SECRET: '',
  LIVE_BRIDGE_URL: '',
  LIVE_APP_BASE_URL: '',
  LIVE_CUSTOMER_CALLS_ENABLED: 'false',
  TWILIO_ACCOUNT_SID: '',
  TWILIO_API_KEY_SID: '',
  TWILIO_API_KEY_SECRET: '',
  TWILIO_AUTH_TOKEN: '',
  TWILIO_TWIML_APP_SID: '',
  TWILIO_CALLER_ID: '',
};
const previewEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL: stagingHubProjectUrl,
  VERCEL_ENV: 'preview',
};
const unconfiguredPreviewEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL: '',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
  NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE: '',
  NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL: '',
  NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY: '',
  HUB_OWNER_ADMIN_AUTH_USER_IDS: '',
  CRON_SECRET: '',
  VERCEL_ENV: 'preview',
};
const previewAuthBundleValues = {
  NEXT_PUBLIC_SUPABASE_URL: stagingHubProjectUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: publishableKey,
  SUPABASE_SERVICE_ROLE_KEY: 'configured-service-role',
  NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE: 'hub',
  NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL: quoteProjectUrl,
  NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY: publishableKey,
  HUB_OWNER_ADMIN_AUTH_USER_IDS: '123e4567-e89b-42d3-a456-426614174000',
  CRON_SECRET: '0123456789abcdef',
};

function run(overrides = {}) {
  return spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, ...baseline, ...overrides },
  });
}

describe('authorization runtime preflight', () => {
  it('allows only a fully unconfigured preview to build in fail-closed mode', () => {
    const unconfigured = run(unconfiguredPreviewEnvironment);
    expect(unconfigured.status).toBe(0);
    expect(unconfigured.stdout).toContain(
      'AUTH_RUNTIME_CONFIG_OK mode=unconfigured_preview',
    );

    const production = run({
      ...unconfiguredPreviewEnvironment,
      VERCEL_ENV: 'production',
    });
    expect(production.status).toBe(1);
    expect(production.stderr).toContain('NEXT_PUBLIC_SUPABASE_URL is required');

    const enabledWriter = run({
      ...unconfiguredPreviewEnvironment,
      CRON_ENABLED: 'true',
    });
    expect(enabledWriter.status).toBe(1);
    expect(enabledWriter.stderr).toContain('CRON_ENABLED must remain false');
  });

  it.each(Object.entries(previewAuthBundleValues))(
    'rejects an unconfigured preview when only %s is supplied',
    (name, value) => {
      const result = run({
        ...unconfiguredPreviewEnvironment,
        [name]: value,
      });
      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain('mode=unconfigured_preview');
    },
  );

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

  it('requires an explicit identity source and keeps Quote Tool identity preview-only', () => {
    const missing = run({ NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE: '' });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('must be exactly hub or quote_tool');

    const wrongCase = run({ NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE: 'HUB' });
    expect(wrongCase.status).toBe(1);
    expect(wrongCase.stderr).toContain('must be exactly hub or quote_tool');

    const missingQuoteConfiguration = run({
      ...previewEnvironment,
      NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE: 'quote_tool',
    });
    expect(missingQuoteConfiguration.status).toBe(1);
    expect(missingQuoteConfiguration.stderr).toContain(
      'NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL is required',
    );

    const preview = run({
      ...previewEnvironment,
      NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE: 'quote_tool',
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL: quoteProjectUrl,
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY: publishableKey,
    });
    expect(preview.status).toBe(0);

    const missingPreview = run({
      NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE: 'quote_tool',
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL: quoteProjectUrl,
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY: publishableKey,
      VERCEL_ENV: '',
    });
    expect(missingPreview.status).toBe(1);
    expect(missingPreview.stderr).toContain('may be quote_tool only when VERCEL_ENV is preview');

    const production = run({
      NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE: 'quote_tool',
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL: quoteProjectUrl,
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY: publishableKey,
      VERCEL_ENV: 'production',
    });
    expect(production.status).toBe(1);
    expect(production.stderr).toContain('may be quote_tool only when VERCEL_ENV is preview');
  });

  it('accepts a legacy anon JWT as the browser-safe compatibility key', () => {
    const result = run({ NEXT_PUBLIC_SUPABASE_ANON_KEY: legacyKey('anon') });
    expect(result.status).toBe(0);
  });

  it.each([
    ['NEXT_PUBLIC_SUPABASE_URL', 'not-a-url'],
    ['NEXT_PUBLIC_SUPABASE_URL', 'https://example.invalid'],
    ['NEXT_PUBLIC_SUPABASE_URL', `${hubProjectUrl}/rest/v1`],
    ['NEXT_PUBLIC_SUPABASE_URL', 'https://abcdefghijklmnopqrst.supabase.co:444'],
    ['NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL', 'http://chhntsbnbofyqrpivuog.supabase.co'],
  ])('rejects an invalid hosted Supabase project URL in %s', (name, value) => {
    const result = run({
      ...previewEnvironment,
      NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE: 'quote_tool',
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL: quoteProjectUrl,
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY: publishableKey,
      [name]: value,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${name} must be a credential-free HTTPS Supabase project URL`);
  });

  it.each([
    [
      'NEXT_PUBLIC_SUPABASE_URL',
      'https://operator:password@abcdefghijklmnopqrst.supabase.co',
    ],
    [
      'NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL',
      'https://operator:password@chhntsbnbofyqrpivuog.supabase.co',
    ],
  ])('rejects embedded credentials in %s without printing them', (name, urlWithCredentials) => {
    const result = run({
      ...previewEnvironment,
      NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE: 'quote_tool',
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL: quoteProjectUrl,
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY: publishableKey,
      [name]: urlWithCredentials,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `${name} must be a credential-free HTTPS Supabase project URL`,
    );
    expect(result.stderr).not.toContain(urlWithCredentials);
  });

  it('requires the Hub and Quote Tool Auth projects to be distinct after URL normalization', () => {
    const result = run({
      ...previewEnvironment,
      NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE: 'quote_tool',
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL: `${stagingHubProjectUrl}/`,
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY: publishableKey,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Hub and Quote Tool Auth Supabase project URLs must be distinct');
  });

  it('binds password entry to the frozen Quote Tool Auth project', () => {
    const result = run({
      ...previewEnvironment,
      NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE: 'quote_tool',
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL:
        'https://bcdefghijklmnopqrstu.supabase.co',
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY: publishableKey,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must match the frozen Quote Tool Auth project');
  });

  it('rejects Quote Tool public Auth variables outside Vercel preview even when Hub Auth is selected', () => {
    const result = run({
      NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE: 'hub',
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL: quoteProjectUrl,
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY: publishableKey,
      VERCEL_ENV: 'production',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'NEXT_PUBLIC_QUOTE_TOOL_AUTH_* variables may be set only when VERCEL_ENV is preview',
    );
  });

  it('rejects secret and legacy service-role keys without printing them', () => {
    const secretKey = 'sb_secret_1234567890abcdefghij';
    const secretResult = run({ NEXT_PUBLIC_SUPABASE_ANON_KEY: secretKey });
    expect(secretResult.status).toBe(1);
    expect(secretResult.stderr).toContain(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY must be a browser-safe Supabase publishable or legacy anon key',
    );
    expect(secretResult.stderr).not.toContain(secretKey);

    const serviceRoleKey = legacyKey('service_role');
    const serviceRoleResult = run({
      ...previewEnvironment,
      NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE: 'quote_tool',
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL: quoteProjectUrl,
      NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY: serviceRoleKey,
    });
    expect(serviceRoleResult.status).toBe(1);
    expect(serviceRoleResult.stderr).toContain(
      'NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY must be a browser-safe Supabase publishable or legacy anon key',
    );
    expect(serviceRoleResult.stderr).not.toContain(serviceRoleKey);
  });

  it('keeps customer follow-up sending disabled until reconciliation is implemented', () => {
    const result = run({ GHL_FOLLOWUP_SEND_ENABLED: 'true' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('GHL_FOLLOWUP_SEND_ENABLED must remain false');
  });

  it.each(['CRON_ENABLED', 'GHL_SEND_ENABLED'])('keeps %s disabled', name => {
    const enabled = run({ [name]: 'true' });
    expect(enabled.status).toBe(1);
    expect(enabled.stderr).toContain(
      `${name} must remain false until its separate production activation is reviewed and approved`,
    );

    const malformed = run({ [name]: 'TRUE' });
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain(`${name} must be exactly true or false`);
  });

  it('keeps live customer calls disabled', () => {
    const enabled = run({ LIVE_CUSTOMER_CALLS_ENABLED: 'true' });
    expect(enabled.status).toBe(1);
    expect(enabled.stderr).toContain('LIVE_CUSTOMER_CALLS_ENABLED must remain false');
  });

  it('binds each Vercel environment to its frozen Hub Supabase project', () => {
    const wrongProduction = run({ NEXT_PUBLIC_SUPABASE_URL: stagingHubProjectUrl });
    expect(wrongProduction.status).toBe(1);
    expect(wrongProduction.stderr).toContain(
      'NEXT_PUBLIC_SUPABASE_URL must match the frozen production Hub project',
    );

    const wrongPreview = run({
      ...previewEnvironment,
      NEXT_PUBLIC_SUPABASE_URL: hubProjectUrl,
    });
    expect(wrongPreview.status).toBe(1);
    expect(wrongPreview.stderr).toContain(
      'NEXT_PUBLIC_SUPABASE_URL must match the frozen preview Hub project',
    );

    const unknownEnvironment = run({
      VERCEL_ENV: '',
      NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    });
    expect(unknownEnvironment.status).toBe(1);
    expect(unknownEnvironment.stderr).toContain(
      'VERCEL_ENV must be exactly preview or production for deployment',
    );
  });

  it('rejects the same Owner/Admin UUID twice even when hex casing differs', () => {
    const result = run({
      HUB_OWNER_ADMIN_AUTH_USER_IDS:
        '123e4567-e89b-42d3-a456-426614174000,123E4567-E89B-42D3-A456-426614174000',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('exactly two unique Supabase Auth UUIDs');
  });

  it('keeps phone auth and Turnstile deferred while password login is selected', () => {
    const malformed = run({ HUB_PHONE_AUTH_STAGING_ENABLED: 'yes' });
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain('must be exactly true or false');

    const enabled = run({
      ...previewEnvironment,
      HUB_PHONE_AUTH_STAGING_ENABLED: 'true',
    });
    expect(enabled.status).toBe(1);
    expect(enabled.stderr).toContain('must remain false while password login is selected');

    const turnstileConfigured = run({
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'public-site-key',
    });
    expect(turnstileConfigured.status).toBe(1);
    expect(turnstileConfigured.stderr).toContain('must remain unset while Turnstile is deferred');
  });
});
