export function normalizeOperatorEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return email && email.includes('@') ? email : null;
}

export function isConfirmedUnbannedQuoteToolUser(user, expectedEmail, now = new Date()) {
  if (!user || typeof user.id !== 'string' || !user.id.trim()) return false;
  if (normalizeOperatorEmail(user.email) !== expectedEmail) return false;
  if (typeof user.email_confirmed_at !== 'string' || Number.isNaN(Date.parse(user.email_confirmed_at))) {
    return false;
  }
  if (user.banned_until == null || user.banned_until === '') return true;
  const bannedUntil = Date.parse(user.banned_until);
  return Number.isFinite(bannedUntil) && bannedUntil <= now.getTime();
}

export function selectExactlyOneActiveHubEmployee(rows, expectedEmail) {
  if (!Array.isArray(rows)) return null;
  const matches = rows.filter(row =>
    row
    && row.active === true
    && typeof row.id === 'string'
    && row.id.trim()
    && normalizeOperatorEmail(row.compatibility_email) === expectedEmail,
  );
  return matches.length === 1 ? matches[0] : null;
}
