// Vercel build preflight for the single stable phone-auth staging branch.
// Error output names configuration fields but never prints their values.

import { fileURLToPath } from 'node:url';
import {
  STAGING_PHONE_AUTH_BRANCH,
  isStagingPhoneAuthBranch,
  resolveStagingPhoneAuthActivation,
} from '../src/lib/auth/stagingPhoneAuth.mjs';

const PRODUCTION_SUPABASE_PROJECT_REF = 'mjmociuxxxwxvasnpxav';
const HOSTED_SUPABASE_PROJECT_REF = /^[a-z0-9]{20}$/;
const PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]{16,}$/;
const SECRET_KEY = /^sb_secret_[A-Za-z0-9_-]{16,}$/;
const JWT_SEGMENT = /^[A-Za-z0-9_-]+$/;
const OWNER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUIRED_STAGING_VALUES = [
  'HUB_STAGING_SUPABASE_PROJECT_REF',
  'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];
const REQUIRED_FALSE_SWITCHES = [
  'LIVE_CUSTOMER_CALLS_ENABLED',
  'GHL_SEND_ENABLED',
  'GHL_FOLLOWUP_SEND_ENABLED',
  'CRON_ENABLED',
];
const FORBIDDEN_QUOTE_TOOL_VALUES = [
  'QUOTE_TOOL_SUPABASE_URL',
  'QUOTE_TOOL_SUPABASE_SERVICE_ROLE_KEY',
];

function hasValue(environment, name) {
  return typeof environment[name] === 'string' && environment[name].trim().length > 0;
}

function validateOwnerIds(environment, errors) {
  const ids = (environment.HUB_OWNER_ADMIN_AUTH_USER_IDS ?? '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  if (ids.length !== 2 || new Set(ids).size !== 2 || ids.some(id => !OWNER_UUID.test(id))) {
    errors.push(
      'HUB_OWNER_ADMIN_AUTH_USER_IDS must contain exactly two unique Supabase Auth UUIDs',
    );
  }
}

function decodedLegacyJwtRole(value) {
  const parts = value.split('.');
  if (parts.length !== 3 || parts.some(part => !JWT_SEGMENT.test(part))) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const legacyHeader = typeof header === 'object'
      && header !== null
      && header.alg === 'HS256'
      && header.typ === 'JWT';
    return legacyHeader
      && typeof payload === 'object'
      && payload !== null
      && typeof payload.role === 'string'
      ? payload.role
      : null;
  } catch {
    return null;
  }
}

function validateSupabaseApiKeys(environment, errors) {
  const anonKey = environment.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (hasValue(environment, 'NEXT_PUBLIC_SUPABASE_ANON_KEY')) {
    const validAnon = anonKey === anonKey.trim()
      && (PUBLISHABLE_KEY.test(anonKey) || decodedLegacyJwtRole(anonKey) === 'anon');
    if (!validAnon) {
      errors.push('NEXT_PUBLIC_SUPABASE_ANON_KEY must be a Supabase publishable or legacy anon key');
    }
  }

  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY;
  if (hasValue(environment, 'SUPABASE_SERVICE_ROLE_KEY')) {
    const validServiceRole = serviceRoleKey === serviceRoleKey.trim()
      && (SECRET_KEY.test(serviceRoleKey)
        || decodedLegacyJwtRole(serviceRoleKey) === 'service_role');
    if (!validServiceRole) {
      errors.push(
        'SUPABASE_SERVICE_ROLE_KEY must be a Supabase secret or legacy service_role key',
      );
    }
  }
}

function validateStagingSupabaseUrl(environment, errors) {
  const projectRef = environment.HUB_STAGING_SUPABASE_PROJECT_REF;
  const validProjectRef = typeof projectRef === 'string'
    && projectRef === projectRef.trim()
    && HOSTED_SUPABASE_PROJECT_REF.test(projectRef);

  if (hasValue(environment, 'HUB_STAGING_SUPABASE_PROJECT_REF') && !validProjectRef) {
    errors.push(
      'HUB_STAGING_SUPABASE_PROJECT_REF must be a 20-character hosted Supabase project ref',
    );
  }
  if (validProjectRef && projectRef === PRODUCTION_SUPABASE_PROJECT_REF) {
    errors.push('HUB_STAGING_SUPABASE_PROJECT_REF must reference the separate staging project');
  }

  if (!hasValue(environment, 'NEXT_PUBLIC_SUPABASE_URL')) return;
  const rawUrl = environment.NEXT_PUBLIC_SUPABASE_URL;
  if (rawUrl !== rawUrl.trim()) {
    errors.push('NEXT_PUBLIC_SUPABASE_URL must not contain surrounding whitespace');
    return;
  }
  try {
    const url = new URL(rawUrl);
    const hostedProject = /^([a-z0-9]+)\.supabase\.co$/.exec(url.hostname);
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash
      || !hostedProject
    ) {
      errors.push('NEXT_PUBLIC_SUPABASE_URL must be a credential-free hosted Supabase project URL');
      return;
    }
    if (hostedProject[1] === PRODUCTION_SUPABASE_PROJECT_REF) {
      errors.push('NEXT_PUBLIC_SUPABASE_URL must reference the separate staging Supabase project');
    }
    if (validProjectRef && hostedProject[1] !== projectRef) {
      errors.push('NEXT_PUBLIC_SUPABASE_URL must match HUB_STAGING_SUPABASE_PROJECT_REF');
    }
  } catch {
    errors.push('NEXT_PUBLIC_SUPABASE_URL must be a credential-free hosted Supabase project URL');
  }
}

export function validateStagingDeployment(environment = process.env) {
  const errors = [];
  const activation = resolveStagingPhoneAuthActivation(environment);
  const flag = environment.HUB_PHONE_AUTH_STAGING_ENABLED;

  if (flag !== undefined && flag !== 'true' && flag !== 'false') {
    errors.push('HUB_PHONE_AUTH_STAGING_ENABLED must be exactly true or false');
  }
  if (flag !== 'true') return errors;

  if (environment.VERCEL_ENV !== 'preview') {
    errors.push('phone auth may be enabled only when VERCEL_ENV is preview');
  }
  if (environment.VERCEL_GIT_COMMIT_REF !== STAGING_PHONE_AUTH_BRANCH) {
    errors.push(`phone auth may be enabled only on the ${STAGING_PHONE_AUTH_BRANCH} branch`);
  }
  if (activation !== 'enabled' || !isStagingPhoneAuthBranch(environment)) {
    // The two specific errors above explain the rejected context. This guard
    // makes a future shared-resolver change fail closed here too.
    if (errors.length === 0) errors.push('phone-auth activation context is unavailable');
  }

  for (const name of REQUIRED_STAGING_VALUES) {
    if (!hasValue(environment, name)) errors.push(`${name} is required for staging phone auth`);
  }
  validateOwnerIds(environment, errors);
  validateStagingSupabaseUrl(environment, errors);
  validateSupabaseApiKeys(environment, errors);

  if (
    hasValue(environment, 'NEXT_PUBLIC_SUPABASE_ANON_KEY')
    && hasValue(environment, 'SUPABASE_SERVICE_ROLE_KEY')
    && environment.NEXT_PUBLIC_SUPABASE_ANON_KEY === environment.SUPABASE_SERVICE_ROLE_KEY
  ) {
    errors.push('staging Supabase browser and service-role credentials must be different');
  }

  for (const name of REQUIRED_FALSE_SWITCHES) {
    if (environment[name] !== 'false') errors.push(`${name} must be explicitly false in staging`);
  }
  for (const name of FORBIDDEN_QUOTE_TOOL_VALUES) {
    if (hasValue(environment, name)) errors.push(`${name} must be absent from staging`);
  }
  return errors;
}

function main() {
  const errors = validateStagingDeployment();
  if (errors.length > 0) {
    process.stderr.write('STAGING_DEPLOYMENT_CONFIG_INVALID\n');
    for (const error of errors) process.stderr.write(`- ${error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('STAGING_DEPLOYMENT_CONFIG_OK\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
