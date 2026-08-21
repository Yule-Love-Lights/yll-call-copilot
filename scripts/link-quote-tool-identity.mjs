// Explicit staging operator bridge. This never creates a Quote Tool user or a
// Hub employee. It links one already-confirmed Quote Tool Auth user to one
// existing active Hub employee through the Hub's guarded service-role RPC.
// It never prints email addresses, UUIDs, keys, or other account details.
//
// Usage: node scripts/link-quote-tool-identity.mjs <staff-email>

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  isConfirmedUnbannedQuoteToolUser,
  normalizeOperatorEmail,
  selectExactlyOneActiveHubEmployee,
} from './quote-tool-identity-logic.mjs';

const BRIDGE_REASON = 'quote_tool_shared_identity_operator_confirmed';

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
    const index = line.indexOf('=');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function environmentValue(fileEnv, name) {
  return process.env[name]?.trim() || fileEnv[name]?.trim() || '';
}

async function findExactQuoteToolUser(admin, email) {
  const matches = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return null;
    matches.push(...data.users.filter(user => normalizeOperatorEmail(user.email) === email));
    if (data.users.length < 1000) break;
  }

  return matches.length === 1 && isConfirmedUnbannedQuoteToolUser(matches[0], email)
    ? matches[0]
    : null;
}

const email = normalizeOperatorEmail(process.argv[2]);
if (!email) {
  console.error('Usage: node scripts/link-quote-tool-identity.mjs <staff-email>');
  process.exit(1);
}

const fileEnv = loadEnvLocal();
const hubUrl = environmentValue(fileEnv, 'NEXT_PUBLIC_SUPABASE_URL');
const hubServiceRoleKey = environmentValue(fileEnv, 'SUPABASE_SERVICE_ROLE_KEY');
const quoteUrl = environmentValue(fileEnv, 'QUOTE_TOOL_SUPABASE_URL');
const quoteServiceRoleKey = environmentValue(fileEnv, 'QUOTE_TOOL_SUPABASE_SERVICE_ROLE_KEY');

if (!hubUrl || !hubServiceRoleKey || !quoteUrl || !quoteServiceRoleKey) {
  console.error(
    'Missing Hub or Quote Tool server configuration. Required names: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, QUOTE_TOOL_SUPABASE_URL, QUOTE_TOOL_SUPABASE_SERVICE_ROLE_KEY.',
  );
  process.exit(1);
}

const quoteAdmin = createClient(quoteUrl, quoteServiceRoleKey, { auth: { persistSession: false } });
const hubAdmin = createClient(hubUrl, hubServiceRoleKey, { auth: { persistSession: false } });

const quoteUser = await findExactQuoteToolUser(quoteAdmin, email);
if (!quoteUser) {
  console.error('Quote Tool staff identity could not be confirmed for linking. No Hub identity change was made.');
  process.exit(1);
}

const { data: employees, error: employeeError } = await hubAdmin
  .from('ops_employees')
  .select('id, active, compatibility_email')
  .eq('compatibility_email', email)
  .eq('active', true)
  .limit(2);
const employee = employeeError ? null : selectExactlyOneActiveHubEmployee(employees, email);
if (!employee) {
  console.error('Hub staff identity could not be confirmed for linking. No Hub identity change was made.');
  process.exit(1);
}

const { data, error } = await hubAdmin.rpc('link_quote_tool_employee_identity', {
  p_employee_id: employee.id,
  p_quote_tool_auth_user_id: quoteUser.id,
  p_reason: BRIDGE_REASON,
});
const row = Array.isArray(data) ? data[0] : data;
if (error || !row?.employee_id) {
  console.error('Quote Tool identity link could not be completed. Review protected database logs before retrying.');
  process.exit(1);
}

console.log('Quote Tool identity link confirmed. No identifier was printed.');
