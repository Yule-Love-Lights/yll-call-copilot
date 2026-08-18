// Create a legacy Office login: a Supabase auth user (email confirmed, so no
// SMTP needed) plus the immutable Hub employee/Auth link, Office membership,
// audit, and guarded app_users compatibility projection. If the auth user
// already exists, the atomic provisioning RPC verifies the same identity link.
// Reads .env.local itself and never prints secret values or employee
// identifiers. This helper cannot provision any field, Manager, or Owner/Admin
// identity.
//
// Usage: node scripts/create-user.mjs <email> <temp-password> [role]

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  inspectExistingEmployeeAuthLink,
  provisionLegacyOfficeWithRetry,
} from './create-user-logic.mjs';

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

const [rawEmail, password, requestedRole = 'rep'] = process.argv.slice(2);
const email = rawEmail?.trim().toLowerCase();
if (!email || !email.includes('@') || !password) {
  console.error('Usage: node scripts/create-user.mjs <email> <temp-password> [role]');
  process.exit(1);
}

// This is a legacy Office bootstrap script, not the future field provisioning
// path. Keep the database input closed so a typo or an unsupported role cannot
// become elevated through old `role !== "rep"` assumptions. Advertising,
// Installer, and Manager provisioning remains blocked by the Phase 0 gates.
const role = requestedRole.trim().toLowerCase();
const BOOTSTRAP_ROLES = new Set(['rep', 'office']);
if (!BOOTSTRAP_ROLES.has(role)) {
  console.error(
    'This legacy script creates Office bootstrap users only. Allowed roles: rep, office. Owner/Admin and field provisioning require separate audited paths.',
  );
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
const { data: createdData, error: createError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
let authUserId = createdData?.user?.id ?? null;

if (createError) {
  const alreadyExists =
    createError.code === 'email_exists' || /already.*registered/i.test(createError.message ?? '');
  if (!alreadyExists) {
    console.error('Auth user creation failed; no staff allowlist change was attempted.');
    process.exit(1);
  }
  authStatus = 'existing';
  authUserId = await findAuthUserIdByEmail(admin, email);
}

if (!authUserId) {
  console.error('Auth user could not be resolved for Office provisioning.');
  process.exit(1);
}

if (authStatus === 'existing') {
  const link = await inspectExistingEmployeeAuthLink(admin, authUserId);
  if (link.status === 'unavailable') {
    console.error('Existing staff identity verification is temporarily unavailable.');
    process.exit(1);
  }
  if (link.status !== 'linked') {
    console.error(
      'The existing Auth user is not an approved staff identity. Naldo or Jason must review it through the audited recovery process.',
    );
    process.exit(1);
  }
}

// app_users is now a guarded compatibility projection. The service-role-only
// database routine creates or verifies the immutable employee/auth link,
// canonical Office membership, audit row, and projection atomically.
const provisionResult = await provisionLegacyOfficeWithRetry(admin, {
  p_auth_user_id: authUserId,
  p_compatibility_email: email,
  p_reason: 'legacy_office_bootstrap',
});

if (provisionResult.status !== 'provisioned') {
  console.error(
    'Immutable Office employee provisioning failed. Review protected database logs; Naldo or Jason must reconcile any incomplete Auth user before retrying.',
  );
  process.exit(1);
}

console.log(`Legacy Office auth user: ${authStatus}.`);
console.log('Immutable Office employee link ensured. No identifier was printed.');

async function findAuthUserIdByEmail(client, normalizedEmail) {
  const perPage = 1000;
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error('Existing auth user lookup failed.');
      process.exit(1);
    }

    const match = data.users.find(user => user.email?.trim().toLowerCase() === normalizedEmail);
    if (match?.id) return match.id;
    if (data.users.length < perPage) break;
  }

  console.error('Existing auth user was not found for Office provisioning.');
  process.exit(1);
}
