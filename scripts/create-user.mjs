// Create a staff login: a Supabase auth user (email confirmed, so no SMTP
// needed) plus an app_users allowlist row. Idempotent-ish: if the auth user
// already exists we still ensure the app_users row. Reads .env.local itself
// and never prints secret values.
//
// Usage: node scripts/create-user.mjs <email> <temp-password> [role]

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

function loadEnvLocal() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let text;
  try {
    text = readFileSync(resolve(root, '.env.local'), 'utf8');
  } catch {
    return {};
  }
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const [email, password, role = 'rep'] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: node scripts/create-user.mjs <email> <temp-password> [role]');
  process.exit(1);
}

const fileEnv = loadEnvLocal();
// Shell env wins when set to a non-empty value; .env.local is the fallback.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (checked shell env and .env.local).',
  );
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

let authStatus = 'created';
const { error: createError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});

if (createError) {
  const alreadyExists =
    createError.code === 'email_exists' || /already.*registered/i.test(createError.message ?? '');
  if (!alreadyExists) {
    console.error(`Auth user creation failed: ${createError.message}`);
    process.exit(1);
  }
  authStatus = 'already existed (left as is; password unchanged)';
}

// Emails are stored lowercased so the allowlist can match exactly against
// Supabase auth's lowercased emails.
const { error: upsertError } = await admin
  .from('app_users')
  .upsert({ email: email.toLowerCase(), role }, { onConflict: 'email' });

if (upsertError) {
  console.error(`app_users upsert failed: ${upsertError.message}`);
  process.exit(1);
}

console.log(`Auth user ${email.toLowerCase()}: ${authStatus}.`);
console.log(`app_users row ensured with role "${role}".`);
