// Deployment preflight for the Phase 0 authorization boundary. This reads
// names/presence only and never prints secret values.

import {
  HUB_SUPABASE_PROJECT_URLS_BY_VERCEL_ENV,
  isBrowserSafeSupabaseKey,
  matchesFrozenHubSupabaseProject,
  matchesFrozenQuoteToolAuthSupabaseProject,
  normalizeHostedSupabaseProjectUrl,
} from '../src/lib/auth/publicSupabaseConfig.mjs';

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

const authConfigurationNames = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CRON_SECRET',
  'NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE',
  'NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL',
  'NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY',
  'HUB_OWNER_ADMIN_AUTH_USER_IDS',
];
const unconfiguredPreview =
  process.env.VERCEL_ENV === 'preview'
  && authConfigurationNames.every(name => !process.env[name]?.trim());

if (!unconfiguredPreview) {
  required('NEXT_PUBLIC_SUPABASE_URL');
  required('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  required('SUPABASE_SERVICE_ROLE_KEY');
  strongSecret('CRON_SECRET');
}

if (!['preview', 'production'].includes(process.env.VERCEL_ENV)) {
  errors.push('VERCEL_ENV must be exactly preview or production for deployment');
}

for (const name of ['CRON_ENABLED', 'GHL_SEND_ENABLED']) {
  const value = process.env[name];
  if (value && !['true', 'false'].includes(value)) {
    errors.push(`${name} must be exactly true or false`);
  }
  if (value === 'true') {
    errors.push(`${name} must remain false until its separate production activation is reviewed and approved`);
  }
}

const hubUrlRaw = process.env.NEXT_PUBLIC_SUPABASE_URL;
const hubUrl = normalizeHostedSupabaseProjectUrl(hubUrlRaw);
if (hubUrlRaw?.trim() && !hubUrl) {
  errors.push(
    'NEXT_PUBLIC_SUPABASE_URL must be a credential-free HTTPS Supabase project URL',
  );
}
if (hubUrl && !matchesFrozenHubSupabaseProject(hubUrl, process.env.VERCEL_ENV)) {
  const expected = HUB_SUPABASE_PROJECT_URLS_BY_VERCEL_ENV[process.env.VERCEL_ENV];
  errors.push(`NEXT_PUBLIC_SUPABASE_URL must match the frozen ${process.env.VERCEL_ENV} Hub project${expected ? '' : ' configuration'}`);
}
const hubPublicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (hubPublicKey?.trim() && !isBrowserSafeSupabaseKey(hubPublicKey)) {
  errors.push(
    'NEXT_PUBLIC_SUPABASE_ANON_KEY must be a browser-safe Supabase publishable or legacy anon key',
  );
}

const identitySource = process.env.NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE;
const productionQuoteToolIdentityEnabled =
  process.env.HUB_QUOTE_TOOL_IDENTITY_PRODUCTION_ENABLED === 'true';
if (
  process.env.HUB_QUOTE_TOOL_IDENTITY_PRODUCTION_ENABLED
  && !['true', 'false'].includes(process.env.HUB_QUOTE_TOOL_IDENTITY_PRODUCTION_ENABLED)
) {
  errors.push('HUB_QUOTE_TOOL_IDENTITY_PRODUCTION_ENABLED must be exactly true or false');
}
if (!unconfiguredPreview) {
  if (!['hub', 'quote_tool'].includes(identitySource)) {
    errors.push('NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE must be exactly hub or quote_tool');
  } else if (identitySource === 'quote_tool') {
    if (process.env.VERCEL_ENV === 'production' && !productionQuoteToolIdentityEnabled) {
      errors.push('production Quote Tool identity requires HUB_QUOTE_TOOL_IDENTITY_PRODUCTION_ENABLED=true');
    } else if (!['preview', 'production'].includes(process.env.VERCEL_ENV)) {
      errors.push('NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE may be quote_tool only in preview or explicitly enabled production');
    }
  }
  if (process.env.VERCEL_ENV === 'production' && identitySource !== 'hub' && !productionQuoteToolIdentityEnabled) {
    errors.push('NEXT_PUBLIC_HUB_AUTH_IDENTITY_SOURCE must be hub unless production Quote Tool identity is explicitly enabled');
  }
}

const quoteUrlRaw = process.env.NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL;
const quotePublicKey = process.env.NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY;
const quoteConfigurationPresent = Boolean(quoteUrlRaw?.trim() || quotePublicKey?.trim());
if (
  quoteConfigurationPresent
  && process.env.VERCEL_ENV !== 'preview'
  && !(process.env.VERCEL_ENV === 'production' && productionQuoteToolIdentityEnabled)
) {
  errors.push('NEXT_PUBLIC_QUOTE_TOOL_AUTH_* variables may be set only in preview or explicitly enabled production');
}
if (identitySource === 'quote_tool' || quoteConfigurationPresent) {
  required('NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL');
  required('NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY');

  const quoteUrl = normalizeHostedSupabaseProjectUrl(quoteUrlRaw);
  if (quoteUrlRaw?.trim() && !quoteUrl) {
    errors.push(
      'NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL must be a credential-free HTTPS Supabase project URL',
    );
  }
  if (quotePublicKey?.trim() && !isBrowserSafeSupabaseKey(quotePublicKey)) {
    errors.push(
      'NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_ANON_KEY must be a browser-safe Supabase publishable or legacy anon key',
    );
  }
  if (hubUrl && quoteUrl && hubUrl === quoteUrl) {
    errors.push('Hub and Quote Tool Auth Supabase project URLs must be distinct');
  }
  if (quoteUrl && !matchesFrozenQuoteToolAuthSupabaseProject(quoteUrl)) {
    errors.push(
      'NEXT_PUBLIC_QUOTE_TOOL_AUTH_SUPABASE_URL must match the frozen Quote Tool Auth project',
    );
  }
}

const phoneAuthFlag = process.env.HUB_PHONE_AUTH_STAGING_ENABLED ?? 'false';
if (!['true', 'false'].includes(phoneAuthFlag)) {
  errors.push('HUB_PHONE_AUTH_STAGING_ENABLED must be exactly true or false');
}
if (phoneAuthFlag === 'true') {
  errors.push('HUB_PHONE_AUTH_STAGING_ENABLED must remain false while password login is selected');
}
if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()) {
  errors.push('NEXT_PUBLIC_TURNSTILE_SITE_KEY must remain unset while Turnstile is deferred');
}

const ownerIds = (process.env.HUB_OWNER_ADMIN_AUTH_USER_IDS ?? '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)
  .map(value => value.toLowerCase());
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (
  !unconfiguredPreview
  && (ownerIds.length !== 2
    || new Set(ownerIds).size !== 2
    || ownerIds.some(id => !uuid.test(id)))
) {
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

console.log(
  unconfiguredPreview
    ? 'AUTH_RUNTIME_CONFIG_OK mode=unconfigured_preview'
    : 'AUTH_RUNTIME_CONFIG_OK mode=configured',
);
