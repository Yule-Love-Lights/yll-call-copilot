function decodeBase64Url(value) {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(
      Math.ceil(value.length / 4) * 4,
      '=',
    );
    return atob(padded);
  } catch {
    return null;
  }
}

// Only keys safe to embed in a browser bundle may authenticate a Hub browser
// session. Modern Supabase publishable keys are opaque; legacy anon keys are
// JWTs whose role claim is explicitly `anon`.
export function isBrowserSafeSupabaseKey(value) {
  const key = value?.trim();
  if (!key) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key)) return true;

  const parts = key.split('.');
  if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) {
    return false;
  }
  const payload = decodeBase64Url(parts[1]);
  if (!payload) return false;
  try {
    const decoded = JSON.parse(payload);
    return decoded.role === 'anon';
  } catch {
    return false;
  }
}

// Deployment preflight accepts only the canonical hosted project URL form.
// It intentionally rejects custom hosts and local URLs so a deployment cannot
// cross projects through a typo, embedded credential, proxy, or path override.
export function normalizeHostedSupabaseProjectUrl(value) {
  const rawUrl = value?.trim();
  if (!rawUrl || rawUrl !== value) return null;

  try {
    const parsed = new URL(rawUrl);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash ||
      !/^[a-z0-9]{20}\.supabase\.co$/.test(parsed.hostname)
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function matchesFrozenHubSupabaseProject(url, vercelEnvironment) {
  const expected = HUB_SUPABASE_PROJECT_URLS_BY_VERCEL_ENV[vercelEnvironment];
  return Boolean(expected && url === expected);
}

export function matchesKnownHubSupabaseProject(url) {
  return Object.values(HUB_SUPABASE_PROJECT_URLS_BY_VERCEL_ENV).includes(url);
}

export function matchesFrozenQuoteToolAuthSupabaseProject(url) {
  return url === QUOTE_TOOL_AUTH_SUPABASE_PROJECT_URL;
}

export const HUB_SUPABASE_PROJECT_URLS_BY_VERCEL_ENV = Object.freeze({
  preview: 'https://ewbtkrytrnerypdkuimd.supabase.co/',
  production: 'https://mjmociuxxxwxvasnpxav.supabase.co/',
});
export const QUOTE_TOOL_AUTH_SUPABASE_PROJECT_URL =
  'https://chhntsbnbofyqrpivuog.supabase.co/';
