// Bulk-ingests a folder of real RingCentral .txt call-transcript exports
// from disk -- the practical loader for the owner's ~1,600-file export,
// since uploading that many files through the browser (POST /api/ingest/
// transcripts) is not viable. Two passes:
//
//   pass 1 (always runs, pure/offline) -- parse every file with
//     parseRingCentralTranscript, build the corpus-wide rep-name set with
//     buildRepNameSet, and flag junk (voicemail/IVR) files with
//     junkReason. Nothing here touches the network or the database.
//
//   pass 2 (skipped by --dry-run) -- for each NON-junk file: insert a
//     transcripts row (customer_name via pickCustomerName against the
//     rep set built in pass 1), then hand the inserted ids to the SAME
//     processTranscriptBatch the browser ingest route uses, batched at its
//     existing BATCH_SIZE -- outcome-matching (if HighLevel is configured)
//     and Claude extraction run exactly as they do for a browser upload.
//     None of that logic is reimplemented here.
//
// --dry-run does pass 1 ONLY and prints the stats below: no DB writes, no
// Claude calls, no secrets required -- safe to run against the real folder
// before the database has even been migrated.
//
// Reads .env.local itself (never prints secret values) -- same convention
// as scripts/create-user.mjs. Shell env wins when set.
//
// This script imports the app's TypeScript transcript modules directly
// (so pass 2 can never drift from what the browser route does). Node 24
// has no built-in TypeScript loader, so run it with tsx (already a
// devDependency: `npm install` pulls it in):
//
//   npx tsx scripts/ingest-ringcentral.mjs "<folderPath>" <verticalSlug> [--limit N] [--dry-run]
//
// Example (dry run over the real export, no DB/secrets involved):
//   npx tsx scripts/ingest-ringcentral.mjs "C:\path\to\Ring Central Transcripts" holiday --dry-run
//
// Example (real ingest, first 50 files only, into the "holiday" vertical):
//   npx tsx scripts/ingest-ringcentral.mjs "C:\path\to\Ring Central Transcripts" holiday --limit 50

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

import { junkReason, parseRingCentralTranscript, pickCustomerName } from '../src/lib/transcripts/ringcentral.ts';
import { buildRepNameSet } from '../src/lib/transcripts/repDetection.ts';
import { BATCH_SIZE } from '../src/lib/transcripts/ingest.ts';
import { processTranscriptBatch } from '../src/lib/transcripts/process.ts';

// ─── .env.local (never printed) ─────────────────────────────────────────────

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

// ─── CLI args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const rest = argv.slice(2);
  const positional = [];
  let limit = null;
  let dryRun = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--limit') {
      limit = Number(rest[++i]);
    } else {
      positional.push(arg);
    }
  }

  return { folderPath: positional[0], verticalSlug: positional[1], limit, dryRun };
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const { folderPath, verticalSlug, limit, dryRun } = parseArgs(process.argv);

  if (!folderPath || !verticalSlug) {
    console.error(
      'Usage: npx tsx scripts/ingest-ringcentral.mjs <folderPath> <verticalSlug> [--limit N] [--dry-run]',
    );
    process.exit(1);
  }

  const allFileNames = readdirSync(folderPath).filter(name => name.toLowerCase().endsWith('.txt'));
  const hasLimit = typeof limit === 'number' && !Number.isNaN(limit) && limit >= 0;
  const fileNames = hasLimit ? allFileNames.slice(0, limit) : allFileNames;

  console.log(
    `Found ${allFileNames.length} .txt files in "${folderPath}"` +
      (hasLimit ? `; processing first ${fileNames.length} (--limit ${limit}).` : '.'),
  );

  // ─── Pass 1: parse everything, corpus-wide rep detection, junk flags ────────

  let dateParseFailures = 0;
  const parsedFiles = []; // { name, parsed }

  for (const name of fileNames) {
    const text = readFileSync(resolve(folderPath, name), 'utf8');
    const parsed = parseRingCentralTranscript(name, text);
    if (!parsed.called_at) dateParseFailures++;
    parsedFiles.push({ name, parsed });
  }

  const repNames = buildRepNameSet(parsedFiles.map(f => f.parsed.speakers));

  const repFileCounts = new Map();
  for (const { parsed } of parsedFiles) {
    for (const speaker of new Set(parsed.speakers)) {
      if (repNames.has(speaker)) repFileCounts.set(speaker, (repFileCounts.get(speaker) ?? 0) + 1);
    }
  }

  const junkReasonCounts = {};
  const nonJunkFiles = [];
  let oneCustomerCount = 0;
  let ambiguousCustomerCount = 0;

  for (const file of parsedFiles) {
    const reason = junkReason(file.parsed);
    if (reason) {
      junkReasonCounts[reason] = (junkReasonCounts[reason] ?? 0) + 1;
      continue;
    }
    nonJunkFiles.push(file);
    if (pickCustomerName(file.parsed, repNames)) oneCustomerCount++;
    else ambiguousCustomerCount++;
  }

  const totalJunk = fileNames.length - nonJunkFiles.length;
  const dateParseOk = fileNames.length - dateParseFailures;
  const dateParseRate = fileNames.length > 0 ? ((dateParseOk / fileNames.length) * 100).toFixed(1) : '0.0';

  console.log('\n--- pass 1 stats ---');
  console.log('total files:', fileNames.length);
  console.log(`filename date parsed OK: ${dateParseOk} (${dateParseRate}%), failed: ${dateParseFailures}`);
  console.log(`junk (flagged, not ingested): ${totalJunk}`, junkReasonCounts);
  console.log('non-junk (would be ingested):', nonJunkFiles.length);
  console.log(`  exactly one customer identified: ${oneCustomerCount}`);
  console.log(`  ambiguous (0 or 2+ non-rep speakers): ${ambiguousCustomerCount}`);
  console.log(`\ndetected rep names (${repNames.size}), by file count:`);
  for (const [name, count] of [...repFileCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name}: ${count}`);
  }

  if (dryRun) {
    console.log('\n--dry-run: no database writes, no Claude calls, nothing persisted.');
    return;
  }

  // ─── Pass 2: insert + outcome-match + extract (reuses process.ts) ───────────

  const fileEnv = loadEnvLocal();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (checked shell env and .env.local).');
    process.exit(1);
  }
  // process.ts's dependencies (extract.ts / ghl/client.ts) read these
  // straight off process.env, not as function params, so they need to be
  // set here before processTranscriptBatch runs.
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || fileEnv.ANTHROPIC_API_KEY || '';
  process.env.HIGHLEVEL_API_KEY = process.env.HIGHLEVEL_API_KEY || fileEnv.HIGHLEVEL_API_KEY || '';
  process.env.HIGHLEVEL_LOCATION_ID = process.env.HIGHLEVEL_LOCATION_ID || fileEnv.HIGHLEVEL_LOCATION_ID || '';

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY (checked shell env and .env.local) -- extraction cannot run without it.');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const { data: vertical, error: verticalError } = await supabase
    .from('verticals')
    .select('id, name')
    .eq('slug', verticalSlug)
    .maybeSingle();
  if (verticalError) {
    console.error('Could not look up vertical:', verticalError.message);
    process.exit(1);
  }
  if (!vertical) {
    console.error(`No vertical found for slug "${verticalSlug}". Create it first (see /verticals in the app).`);
    process.exit(1);
  }

  console.log(`\nInserting ${nonJunkFiles.length} transcript rows into vertical "${vertical.name}"...`);

  const insertedIds = [];
  for (const rowsChunk of chunk(nonJunkFiles, 500)) {
    const { data, error } = await supabase
      .from('transcripts')
      .insert(
        rowsChunk.map(({ name, parsed }) => ({
          vertical_id: vertical.id,
          source_file: name,
          customer_name: pickCustomerName(parsed, repNames),
          customer_phone: null,
          called_at: parsed.called_at,
          raw_text: parsed.raw_text,
          metric_scope: 'performance',
        })),
      )
      .select('id');
    if (error) {
      console.error('Insert failed:', error.message);
      process.exit(1);
    }
    insertedIds.push(...data.map(row => row.id));
  }

  console.log(`Inserted ${insertedIds.length} rows. Processing (outcome match + Claude extraction)...`);

  let done = 0;
  let failed = 0;
  const batches = chunk(insertedIds, BATCH_SIZE);
  for (let i = 0; i < batches.length; i++) {
    const result = await processTranscriptBatch({
      supabase,
      transcriptIds: batches[i],
      verticalId: vertical.id,
      verticalName: vertical.name,
      matchOutcomes: true,
    });
    done += result.done;
    failed += result.failed;
    console.log(`  batch ${i + 1}/${batches.length}: +${result.done} done, +${result.failed} failed (running total ${done}/${insertedIds.length})`);
  }

  console.log(`\nDone. ${done} succeeded, ${failed} failed, out of ${insertedIds.length} inserted (${nonJunkFiles.length - insertedIds.length} not inserted).`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
