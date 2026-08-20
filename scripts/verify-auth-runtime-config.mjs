// Deployment preflight for the Phase 0 authorization boundary. This reads
// names/presence only and never prints secret values.

import {
  STAGING_PHONE_AUTH_BRANCH,
  resolveStagingPhoneAuthActivation,
} from '../src/lib/auth/stagingPhoneAuth.mjs';

const errors = [];
const required = name => {
  if (!process.env[name]?.trim()) errors.push(`${name} is required`);
};
const strongSecret = name => {
  const value = process.env[name] ?? '';
  if (value !== value.trim() || value.length < 16 || value.endsWith('=')) {
    errors.push(`${name} must be an unpadded secret of at least 16 characters`);
  }
};

required('NEXT_PUBLIC_SUPABASE_URL');
required('NEXT_PUBLIC_SUPABASE_ANON_KEY');
required('SUPABASE_SERVICE_ROLE_KEY');
strongSecret('CRON_SECRET');

const phoneAuthFlag = process.env.HUB_PHONE_AUTH_STAGING_ENABLED ?? 'false';
if (!['true', 'false'].includes(phoneAuthFlag)) {
  errors.push('HUB_PHONE_AUTH_STAGING_ENABLED must be exactly true or false');
}
if (phoneAuthFlag === 'true') {
  required('NEXT_PUBLIC_TURNSTILE_SITE_KEY');
  if (process.env.VERCEL_ENV !== 'preview') {
    errors.push('HUB_PHONE_AUTH_STAGING_ENABLED may be true only when VERCEL_ENV is preview');
  }
  if (process.env.VERCEL_GIT_COMMIT_REF !== STAGING_PHONE_AUTH_BRANCH) {
    errors.push(`HUB_PHONE_AUTH_STAGING_ENABLED may be true only on the ${STAGING_PHONE_AUTH_BRANCH} branch`);
  }
  if (resolveStagingPhoneAuthActivation(process.env) !== 'enabled' && errors.length === 0) {
    errors.push('HUB_PHONE_AUTH_STAGING_ENABLED activation context is unavailable');
  }
}

const ownerIds = (process.env.HUB_OWNER_ADMIN_AUTH_USER_IDS ?? '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)
  .map(value => value.toLowerCase());
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (ownerIds.length !== 2 || new Set(ownerIds).size !== 2 || ownerIds.some(id => !uuid.test(id))) {
  errors.push('HUB_OWNER_ADMIN_AUTH_USER_IDS must contain exactly two unique Supabase Auth UUIDs (Naldo and Jason)');
}

if (process.env.GHL_WEBHOOK_SECRET) strongSecret('GHL_WEBHOOK_SECRET');
if (process.env.GHL_FOLLOWUP_SEND_ENABLED && !['true', 'false'].includes(process.env.GHL_FOLLOWUP_SEND_ENABLED)) {
  errors.push('GHL_FOLLOWUP_SEND_ENABLED must be exactly true or false');
}
if (process.env.GHL_FOLLOWUP_SEND_ENABLED === 'true') {
  errors.push('GHL_FOLLOWUP_SEND_ENABLED must remain false until recipient refresh and uncertain-delivery reconciliation are implemented and approved');
}
if (process.env.LIVE_BRIDGE_URL || process.env.LIVE_APP_BASE_URL) {
  strongSecret('LIVE_BRIDGE_SECRET');
  required('TWILIO_AUTH_TOKEN');
  required('LIVE_BRIDGE_URL');
  required('LIVE_APP_BASE_URL');
  try {
    const bridgeUrl = new URL(process.env.LIVE_BRIDGE_URL ?? '');
    if (
      bridgeUrl.protocol !== 'wss:' ||
      bridgeUrl.username ||
      bridgeUrl.password ||
      bridgeUrl.search ||
      bridgeUrl.hash
    ) {
      errors.push('LIVE_BRIDGE_URL must be a credential-free wss:// base URL without query or fragment');
    }
  } catch {
    errors.push('LIVE_BRIDGE_URL must be a valid wss:// base URL');
  }
  try {
    const appUrl = new URL(process.env.LIVE_APP_BASE_URL ?? '');
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(appUrl.hostname);
    if (
      appUrl.username ||
      appUrl.password ||
      appUrl.search ||
      appUrl.hash ||
      appUrl.pathname !== '/' ||
      (appUrl.protocol !== 'https:' && !(appUrl.protocol === 'http:' && loopback))
    ) {
      errors.push('LIVE_APP_BASE_URL must use https://, except loopback http:// is allowed for local development');
    }
  } catch {
    errors.push('LIVE_APP_BASE_URL must be a valid HTTPS or loopback HTTP URL');
  }
}

const twilioNames = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_API_KEY_SID',
  'TWILIO_API_KEY_SECRET',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_TWIML_APP_SID',
  'TWILIO_CALLER_ID',
];
if (process.env.LIVE_CUSTOMER_CALLS_ENABLED && !['true', 'false'].includes(process.env.LIVE_CUSTOMER_CALLS_ENABLED)) {
  errors.push('LIVE_CUSTOMER_CALLS_ENABLED must be exactly true or false');
}
if (process.env.LIVE_CUSTOMER_CALLS_ENABLED === 'true') {
  errors.push('LIVE_CUSTOMER_CALLS_ENABLED must remain false until provider hangup, stream-drain, and two-track transcription smokes are implemented and approved');
  for (const name of twilioNames) required(name);
  required('LIVE_BRIDGE_URL');
  required('LIVE_APP_BASE_URL');
  strongSecret('LIVE_BRIDGE_SECRET');
}
if (twilioNames.some(name => process.env[name]?.trim())) {
  for (const name of twilioNames) required(name);
  required('LIVE_BRIDGE_URL');
}

if (errors.length > 0) {
  console.error('AUTH_RUNTIME_CONFIG_INVALID');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('AUTH_RUNTIME_CONFIG_OK');
