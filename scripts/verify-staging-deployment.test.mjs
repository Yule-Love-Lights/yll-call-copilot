import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { validateStagingDeployment } from './verify-staging-deployment.mjs';

const script = fileURLToPath(new URL('./verify-staging-deployment.mjs', import.meta.url));
function legacyJwt(role) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: 'supabase', role })}.dGVzdC1zaWduYXR1cmU`;
}

const secretValues = {
  anon: `sb_${'publishable'}_ci_fixture_abcdefghijklmnopqrstuvwxyz`,
  service: `sb_${'secret'}_ci_fixture_abcdefghijklmnopqrstuvwxyz`,
  quote: 'production-quote-secret-fixture',
  stagingRef: 'abcdefghijklmnopqrst',
  otherRef: 'bcdefghijklmnopqrstu',
};
const validStaging = {
  HUB_PHONE_AUTH_STAGING_ENABLED: 'true',
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'staging',
  HUB_STAGING_SUPABASE_PROJECT_REF: secretValues.stagingRef,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'turnstile-site-key',
  NEXT_PUBLIC_SUPABASE_URL: `https://${secretValues.stagingRef}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: secretValues.anon,
  SUPABASE_SERVICE_ROLE_KEY: secretValues.service,
  HUB_OWNER_ADMIN_AUTH_USER_IDS:
    '123e4567-e89b-42d3-a456-426614174000,223e4567-e89b-42d3-a456-426614174000',
  LIVE_CUSTOMER_CALLS_ENABLED: 'false',
  GHL_SEND_ENABLED: 'false',
  GHL_FOLLOWUP_SEND_ENABLED: 'false',
  CRON_ENABLED: 'false',
  QUOTE_TOOL_SUPABASE_URL: '',
  QUOTE_TOOL_SUPABASE_SERVICE_ROLE_KEY: '',
};

function run(overrides = {}) {
  return spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...validStaging, ...overrides },
  });
}

describe('branch-bound staging deployment contract', () => {
  it('accepts the exact staging preview contract', () => {
    expect(validateStagingDeployment(validStaging)).toEqual([]);
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('STAGING_DEPLOYMENT_CONFIG_OK');
  });

  it('accepts correctly typed publishable/secret keys and legacy role JWTs', () => {
    expect(validateStagingDeployment(validStaging)).toEqual([]);
    expect(validateStagingDeployment({
      ...validStaging,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: legacyJwt('anon'),
      SUPABASE_SERVICE_ROLE_KEY: legacyJwt('service_role'),
    })).toEqual([]);
  });

  it('rejects swapped, elevated, malformed, and whitespace-wrapped Supabase keys', () => {
    const anonError = 'NEXT_PUBLIC_SUPABASE_ANON_KEY must be a Supabase publishable or legacy anon key';
    const serviceError = 'SUPABASE_SERVICE_ROLE_KEY must be a Supabase secret or legacy service_role key';

    for (const anonKey of [
      secretValues.service,
      legacyJwt('service_role'),
      legacyJwt('authenticated'),
      'sb_publishable_short',
      'not-a-key',
      ` ${secretValues.anon}`,
    ]) {
      expect(validateStagingDeployment({
        ...validStaging,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
      })).toContain(anonError);
    }

    for (const serviceKey of [
      secretValues.anon,
      legacyJwt('anon'),
      legacyJwt('authenticated'),
      'sb_secret_short',
      'not-a-key',
      `${secretValues.service} `,
    ]) {
      expect(validateStagingDeployment({
        ...validStaging,
        SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      })).toContain(serviceError);
    }
  });

  it('preserves local, production, and unrelated preview builds while phone auth is off', () => {
    for (const environment of [
      {},
      { HUB_PHONE_AUTH_STAGING_ENABLED: 'false', VERCEL_ENV: 'production' },
      {
        HUB_PHONE_AUTH_STAGING_ENABLED: 'false',
        VERCEL_ENV: 'preview',
        VERCEL_GIT_COMMIT_REF: 'feature-branch',
      },
    ]) {
      expect(validateStagingDeployment(environment)).toEqual([]);
    }
  });

  it('rejects a wrong preview branch and a non-preview staging branch', () => {
    expect(validateStagingDeployment({ ...validStaging, VERCEL_GIT_COMMIT_REF: 'feature' }))
      .toContain('phone auth may be enabled only on the staging branch');
    expect(validateStagingDeployment({ ...validStaging, VERCEL_ENV: 'production' }))
      .toContain('phone auth may be enabled only when VERCEL_ENV is preview');
  });

  it('requires staging Supabase, Turnstile, and exactly two owner identities', () => {
    const errors = validateStagingDeployment({
      ...validStaging,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: '',
      HUB_STAGING_SUPABASE_PROJECT_REF: '',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      HUB_OWNER_ADMIN_AUTH_USER_IDS: '123e4567-e89b-42d3-a456-426614174000',
    });
    expect(errors).toEqual(expect.arrayContaining([
      'HUB_STAGING_SUPABASE_PROJECT_REF is required for staging phone auth',
      'NEXT_PUBLIC_TURNSTILE_SITE_KEY is required for staging phone auth',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY is required for staging phone auth',
      'SUPABASE_SERVICE_ROLE_KEY is required for staging phone auth',
      'HUB_OWNER_ADMIN_AUTH_USER_IDS must contain exactly two unique Supabase Auth UUIDs',
    ]));
  });

  it('requires a hosted staging ref that matches the public Supabase URL', () => {
    expect(validateStagingDeployment({
      ...validStaging,
      HUB_STAGING_SUPABASE_PROJECT_REF: 'not-a-project-ref',
    })).toContain(
      'HUB_STAGING_SUPABASE_PROJECT_REF must be a 20-character hosted Supabase project ref',
    );

    expect(validateStagingDeployment({
      ...validStaging,
      NEXT_PUBLIC_SUPABASE_URL: `https://${secretValues.otherRef}.supabase.co`,
    })).toContain('NEXT_PUBLIC_SUPABASE_URL must match HUB_STAGING_SUPABASE_PROJECT_REF');
  });

  it('rejects the production Supabase project and every Quote Tool credential', () => {
    const errors = validateStagingDeployment({
      ...validStaging,
      HUB_STAGING_SUPABASE_PROJECT_REF: 'mjmociuxxxwxvasnpxav',
      NEXT_PUBLIC_SUPABASE_URL: 'https://mjmociuxxxwxvasnpxav.supabase.co',
      QUOTE_TOOL_SUPABASE_URL: 'https://production-quote.example',
      QUOTE_TOOL_SUPABASE_SERVICE_ROLE_KEY: secretValues.quote,
    });
    expect(errors).toEqual(expect.arrayContaining([
      'HUB_STAGING_SUPABASE_PROJECT_REF must reference the separate staging project',
      'NEXT_PUBLIC_SUPABASE_URL must reference the separate staging Supabase project',
      'QUOTE_TOOL_SUPABASE_URL must be absent from staging',
      'QUOTE_TOOL_SUPABASE_SERVICE_ROLE_KEY must be absent from staging',
    ]));
  });

  it('requires every outbound and cron switch to be present and exactly false', () => {
    for (const name of [
      'LIVE_CUSTOMER_CALLS_ENABLED',
      'GHL_SEND_ENABLED',
      'GHL_FOLLOWUP_SEND_ENABLED',
      'CRON_ENABLED',
    ]) {
      expect(validateStagingDeployment({ ...validStaging, [name]: undefined }))
        .toContain(`${name} must be explicitly false in staging`);
      expect(validateStagingDeployment({ ...validStaging, [name]: 'true' }))
        .toContain(`${name} must be explicitly false in staging`);
    }
  });

  it('never prints credential values on a failed build', () => {
    const result = run({
      NEXT_PUBLIC_SUPABASE_URL: 'not-a-url',
      QUOTE_TOOL_SUPABASE_SERVICE_ROLE_KEY: secretValues.quote,
    });
    expect(result.status).toBe(1);
    const output = `${result.stdout}\n${result.stderr}`;
    for (const value of Object.values(secretValues)) {
      expect(output).not.toContain(value);
    }
  });

  it('keeps package and Vercel build wiring on the fail-closed preflight', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
    const vercelJson = JSON.parse(readFileSync('vercel.json', 'utf8'));
    const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(packageJson.scripts['build:vercel']).toBe(
      'node scripts/verify-staging-deployment.mjs && next build',
    );
    expect(vercelJson.buildCommand).toBe('npm run build:vercel');
    expect(ciWorkflow).toMatch(
      /- name: Build stable staging deployment contract[\s\S]*?run: npm run build:vercel/,
    );
    expect(ciWorkflow).not.toContain('run: npm run verify:staging-deploy');
  });
});
