// Builds protected, directly executable SQL for the reviewed 3/16 recording
// release. UUID-only input is embedded through COPY FROM STDIN because psql
// deliberately does not interpolate variables in \copy arguments.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CANARY_MARKER = '__REVIEWED_CANARY_IDS__';
const REMAINDER_MARKER = '__REVIEWED_REMAINDER_IDS__';
const CANARY_TEMPLATE = fileURLToPath(
  new URL('../supabase/operations/0020_release_recordings_canary.sql', import.meta.url),
);
const REMAINDER_TEMPLATE = fileURLToPath(
  new URL('../supabase/operations/0020_release_recordings_remainder.sql', import.meta.url),
);

function parseIdFile(text, label, expectedCount) {
  if (!text.endsWith('\n')) throw new Error(`${label} ID file must end with one newline`);
  const rows = text.slice(0, -1).split('\n');
  if (rows.length !== expectedCount) {
    throw new Error(`${label} ID file must contain exactly ${expectedCount} UUIDs`);
  }
  const seen = new Set();
  for (const [index, id] of rows.entries()) {
    if (!UUID.test(id)) throw new Error(`${label} ID is not canonical at line ${index + 1}`);
    if (seen.has(id)) throw new Error(`${label} ID file contains a duplicate at line ${index + 1}`);
    seen.add(id);
  }
  const sorted = [...rows].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (rows.some((id, index) => id !== sorted[index])) {
    throw new Error(`${label} ID file must be sorted`);
  }
  return rows;
}

function renderTemplate(template, canaryIds, remainderIds) {
  if (template.split(CANARY_MARKER).length !== 2) {
    throw new Error('recording release template canary marker mismatch');
  }
  if (template.split(REMAINDER_MARKER).length !== 2) {
    throw new Error('recording release template remainder marker mismatch');
  }
  return template
    .replace(CANARY_MARKER, canaryIds.join('\n'))
    .replace(REMAINDER_MARKER, remainderIds.join('\n'));
}

function buildReleaseScripts(
  canaryText,
  remainderText,
  canaryTemplate = readFileSync(CANARY_TEMPLATE, 'utf8'),
  remainderTemplate = readFileSync(REMAINDER_TEMPLATE, 'utf8'),
) {
  const canaryIds = parseIdFile(canaryText, 'canary', 3);
  const remainderIds = parseIdFile(remainderText, 'remainder', 16);
  const overlap = canaryIds.find(id => remainderIds.includes(id));
  if (overlap) throw new Error('canary and remainder ID files overlap');
  return {
    canary: renderTemplate(canaryTemplate, canaryIds, remainderIds),
    remainder: renderTemplate(remainderTemplate, canaryIds, remainderIds),
  };
}

function parseArgs(args) {
  const expected = ['--canary-ids', '--remainder-ids', '--canary-output', '--remainder-output'];
  if (args.length !== 8 || expected.some((flag, index) => args[index * 2] !== flag || !args[index * 2 + 1])) {
    throw new Error(
      'Usage: prepare-0020-recording-release.mjs --canary-ids FILE --remainder-ids FILE --canary-output FILE --remainder-output FILE',
    );
  }
  return {
    canaryIds: args[1],
    remainderIds: args[3],
    canaryOutput: args[5],
    remainderOutput: args[7],
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const paths = parseArgs(process.argv.slice(2));
  if (paths.canaryOutput === paths.remainderOutput) {
    throw new Error('canary and remainder outputs must be different files');
  }
  if (existsSync(paths.canaryOutput) || existsSync(paths.remainderOutput)) {
    throw new Error('recording release output already exists');
  }
  const canaryText = readFileSync(paths.canaryIds, 'utf8');
  const remainderText = readFileSync(paths.remainderIds, 'utf8');
  const scripts = buildReleaseScripts(canaryText, remainderText);
  writeFileSync(paths.canaryOutput, scripts.canary, { flag: 'wx' });
  writeFileSync(paths.remainderOutput, scripts.remainder, { flag: 'wx' });
  const canaryDigest = createHash('sha256').update(canaryText).digest('hex');
  const remainderDigest = createHash('sha256').update(remainderText).digest('hex');
  process.stderr.write(
    `wrote reviewed recording release SQL (canary SHA-256 ${canaryDigest}; remainder SHA-256 ${remainderDigest})\n`,
  );
}

export { buildReleaseScripts, parseIdFile };
