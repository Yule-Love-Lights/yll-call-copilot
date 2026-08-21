function decodeBase64Url(value: string): string | null {
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
export function isBrowserSafeSupabaseKey(value: string | null | undefined): boolean {
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
    const decoded = JSON.parse(payload) as { role?: unknown };
    return decoded.role === 'anon';
  } catch {
    return false;
  }
}
