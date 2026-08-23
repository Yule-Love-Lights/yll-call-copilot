import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

const SUPABASE_PROJECT_REFS = Object.freeze({
  staging: 'ewbtkrytrnerypdkuimd',
  production: 'mjmociuxxxwxvasnpxav',
});

const SESSION_POOLER_HOST = /^aws-\d+-[a-z0-9]+(?:-[a-z0-9]+)*\.pooler\.supabase\.com$/;
const SAFE_EXEC_PATHS = Object.freeze({
  darwin: '/opt/homebrew/opt/libpq@17/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
  linux: '/usr/lib/postgresql/17/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
});

function resolveSafeExecPath(platform = process.platform) {
  const path = SAFE_EXEC_PATHS[platform];
  if (!path) {
    throw new Error('The production migration runner requires macOS or Linux/WSL; native Windows is unsupported');
  }
  return path;
}

function requiredEnvironmentValue(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error(`${name} must be set exactly without surrounding whitespace`);
  }
  return value;
}

function decodeUrlCredential(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error('SUPABASE_DB_URL contains an invalid encoded credential');
  }
}

function parseDatabaseUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('SUPABASE_DB_URL must be a valid PostgreSQL URL');
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('SUPABASE_DB_URL must use the postgres or postgresql protocol');
  }
  if (url.hash) {
    throw new Error('SUPABASE_DB_URL must not contain a fragment');
  }
  if (url.pathname !== '/postgres') {
    throw new Error('SUPABASE_DB_URL must target the postgres database');
  }
  if (url.port === '6543') {
    throw new Error('SUPABASE_DB_URL must not use transaction-pooler port 6543');
  }
  if (url.port !== '5432') {
    throw new Error('SUPABASE_DB_URL must use direct or session-pooler port 5432');
  }

  const searchEntries = [...url.searchParams.entries()];
  if (
    searchEntries.length > 1
    || (searchEntries.length === 1
      && (searchEntries[0][0] !== 'sslmode' || searchEntries[0][1] !== 'require'))
  ) {
    throw new Error('SUPABASE_DB_URL may contain only sslmode=require');
  }

  const username = decodeUrlCredential(url.username);
  const password = decodeUrlCredential(url.password);
  if (!username || !password || password.includes('\0')) {
    throw new Error('SUPABASE_DB_URL must contain non-empty database credentials');
  }

  return { hostname: url.hostname, password, username };
}

function resolveSslRootCertificate(env) {
  const path = requiredEnvironmentValue(env, 'YLL_SUPABASE_SSL_ROOT_CERT');
  if (!isAbsolute(path) || resolve(path) !== path) {
    throw new Error('YLL_SUPABASE_SSL_ROOT_CERT must be an absolute normalized path');
  }
  const expectedSha256 = requiredEnvironmentValue(
    env,
    'YLL_EXPECTED_SUPABASE_SSL_ROOT_CERT_SHA256',
  );
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new Error(
      'YLL_EXPECTED_SUPABASE_SSL_ROOT_CERT_SHA256 must be 64 lowercase hex characters',
    );
  }

  let parent;
  let input;
  let entry;
  let certificate;
  try {
    parent = lstatSync(dirname(path));
    input = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    entry = fstatSync(input);
    certificate = readFileSync(input);
  } catch {
    if (input !== undefined) closeSync(input);
    throw new Error('Supabase SSL root certificate must be a readable protected regular file');
  }
  closeSync(input);

  if (
    !parent.isDirectory()
    || parent.isSymbolicLink()
    || (parent.mode & 0o077) !== 0
    || !entry.isFile()
    || (entry.mode & 0o077) !== 0
    || certificate.length === 0
    || certificate.length > 1024 * 1024
  ) {
    throw new Error('Supabase SSL root certificate must be a readable protected regular file');
  }
  const certificateText = certificate.toString('utf8');
  if (
    !certificateText.includes('-----BEGIN CERTIFICATE-----')
    || !certificateText.includes('-----END CERTIFICATE-----')
    || certificateText.includes('\0')
  ) {
    throw new Error('Supabase SSL root certificate must contain a PEM certificate');
  }
  const actualSha256 = createHash('sha256').update(certificate).digest('hex');
  if (actualSha256 !== expectedSha256) {
    throw new Error('Supabase SSL root certificate SHA-256 does not match review');
  }
  return Object.freeze({ path, sha256: actualSha256 });
}

function resolveSupabaseDatabaseTarget(env = process.env) {
  const environment = requiredEnvironmentValue(env, 'YLL_MIGRATION_ENVIRONMENT');
  const projectRef = SUPABASE_PROJECT_REFS[environment];
  if (!projectRef) {
    throw new Error('YLL_MIGRATION_ENVIRONMENT must be exactly staging or production');
  }

  const expectedRef = requiredEnvironmentValue(env, 'YLL_EXPECTED_SUPABASE_PROJECT_REF');
  if (expectedRef !== projectRef) {
    throw new Error(
      'YLL_EXPECTED_SUPABASE_PROJECT_REF does not match the frozen migration environment',
    );
  }

  const rawUrl = requiredEnvironmentValue(env, 'SUPABASE_DB_URL');
  const parsed = parseDatabaseUrl(rawUrl);
  const sslRootCertificate = resolveSslRootCertificate(env);
  const directHost = `db.${projectRef}.supabase.co`;
  let connectionMode;

  if (parsed.hostname === directHost && parsed.username === 'postgres') {
    connectionMode = 'direct';
  } else if (
    SESSION_POOLER_HOST.test(parsed.hostname)
    && parsed.username === `postgres.${projectRef}`
  ) {
    connectionMode = 'session-pooler';
  } else {
    throw new Error(
      'SUPABASE_DB_URL host and user do not match the frozen direct or session-pooler target',
    );
  }

  return Object.freeze({
    connectionMode,
    database: 'postgres',
    environment,
    hostname: parsed.hostname,
    password: parsed.password,
    port: '5432',
    projectRef,
    sslRootCertificatePath: sslRootCertificate.path,
    sslRootCertificateSha256: sslRootCertificate.sha256,
    username: parsed.username,
  });
}

function buildSanitizedPostgresEnv(env, connection) {
  return {
    LANG: 'C',
    LC_ALL: 'C',
    PATH: resolveSafeExecPath(),
    PGDATABASE: connection.database,
    PGHOST: connection.hostname,
    PGPASSWORD: connection.password,
    PGPORT: connection.port,
    PGGSSENCMODE: 'disable',
    PGSSLCERTMODE: 'disable',
    PGSSLMODE: 'verify-full',
    PGSSLROOTCERT: connection.sslRootCertificatePath,
    PGUSER: connection.username,
  };
}

function buildPasswordlessPostgresUrl(connection) {
  const url = new URL('postgresql://localhost:5432/postgres');
  url.username = connection.username;
  url.hostname = connection.hostname;
  url.port = connection.port;
  url.searchParams.set('connect_timeout', '10');
  url.searchParams.set('sslmode', 'verify-full');
  url.searchParams.set('sslrootcert', connection.sslRootCertificatePath);
  return url.toString();
}

function buildSanitizedSupabaseCliEnv(postgresEnv, supabaseHome) {
  if (
    typeof supabaseHome !== 'string'
    || supabaseHome.length === 0
    || supabaseHome.trim() !== supabaseHome
    || !isAbsolute(supabaseHome)
  ) {
    throw new Error('Supabase CLI home must be an absolute private directory');
  }
  return {
    LANG: 'C',
    LC_ALL: 'C',
    PATH: resolveSafeExecPath(),
    PGDATABASE: postgresEnv.PGDATABASE,
    PGHOST: postgresEnv.PGHOST,
    PGPASSWORD: postgresEnv.PGPASSWORD,
    PGPORT: postgresEnv.PGPORT,
    PGGSSENCMODE: postgresEnv.PGGSSENCMODE,
    PGSSLCERTMODE: postgresEnv.PGSSLCERTMODE,
    PGSSLMODE: postgresEnv.PGSSLMODE,
    PGSSLROOTCERT: postgresEnv.PGSSLROOTCERT,
    PGUSER: postgresEnv.PGUSER,
    SUPABASE_HOME: supabaseHome,
    SUPABASE_PROFILE: 'supabase',
  };
}

export {
  SUPABASE_PROJECT_REFS,
  buildPasswordlessPostgresUrl,
  buildSanitizedSupabaseCliEnv,
  buildSanitizedPostgresEnv,
  resolveSafeExecPath,
  resolveSupabaseDatabaseTarget,
  resolveSslRootCertificate,
};
