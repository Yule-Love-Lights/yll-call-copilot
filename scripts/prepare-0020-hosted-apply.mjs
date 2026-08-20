// Emits the one-time hosted-rollout variant of migration 0020 with ONLY the
// legacy-metric-artifact preflight removed.
//
// Why a generator instead of a checked-in copy: the canonical migration must
// keep its fail-closed gate so the `database-security` CI job still proves the
// rule on a clean database, and PHASE-0-RLS-RUNBOOK.md section 4 is explicit --
// "do not weaken migration assertions to make drift disappear". Deriving the
// variant at apply time means the 3,430-line authorization body is copied
// byte-for-byte from the reviewed file rather than retyped, so the only
// difference from canonical 0020 is the block this script removes.
//
// The removed block only COUNTS rows -- no DDL in 0017..0024 reads, alters, or
// drops weekly_digests, brain_reviews, playbook_proposals, or playbook_versions
// (they appear solely inside 0019's default-deny name list and 0020's own
// preflight/assertion bodies). The resulting schema is therefore identical to
// canonical 0020; only the deploy-time gate differs.
//
// Usage:
//   node scripts/prepare-0020-hosted-apply.mjs            # writes to stdout
//   node scripts/prepare-0020-hosted-apply.mjs out.sql    # writes to a file

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = fileURLToPath(
  new URL('../supabase/migrations/0020_lead_work_authorization.sql', import.meta.url),
);

const OPEN = 'do $legacy_metric_artifact_preflight$';
const CLOSE = '$legacy_metric_artifact_preflight$;';

// Guards that must survive the edit. Stripping the personal-touch preflight
// too would silently disarm a gate that PASSES on current data
// (unsafe_personal_touches = 0 measured 2026-08-20), and the reusable assertion
// function is what lets pgTAP and operators re-run the fail-closed rule later.
const MUST_REMAIN = [
  '$legacy_personal_touch_provenance_preflight$',
  'create function public.assert_legacy_metric_artifacts_reconciled()',
];

const NOTE = `-- HOSTED-ROLLOUT VARIANT (scripts/prepare-0020-hosted-apply.mjs):
-- the preflight block that stood here was removed for this apply only. The
-- operator audit it demands was performed on 2026-08-20: all 28 legacy
-- artifacts (5 weekly_digests, 9 brain_reviews, 14 playbook_proposals,
-- 0 edited playbook_versions) were exported before any DDL ran, and no
-- statement in 0017..0024 touches those rows. They are retained, NOT
-- reconciled -- public.assert_legacy_metric_artifacts_reconciled() therefore
-- still raises until they are quarantined or given metric provenance, which
-- is the intended, visible follow-up. The canonical migration in
-- supabase/migrations/ keeps the gate for CI.`;

function build(sql) {
  const open = sql.indexOf(OPEN);
  if (open === -1) throw new Error(`preflight opener not found: ${OPEN}`);
  if (sql.indexOf(OPEN, open + 1) !== -1) throw new Error('preflight opener appears more than once');

  const closeAt = sql.indexOf(CLOSE, open + OPEN.length);
  if (closeAt === -1) throw new Error(`preflight terminator not found: ${CLOSE}`);
  const end = closeAt + CLOSE.length;

  const out = `${sql.slice(0, open)}${NOTE}${sql.slice(end)}`;

  for (const needle of MUST_REMAIN) {
    if (!out.includes(needle)) throw new Error(`refusing to emit: lost required block ${needle}`);
  }
  // The emitted file must differ from canonical 0020 by exactly one span: the
  // removed block, swapped for NOTE. Anything else means the source moved.
  const removed = sql.slice(open, end);
  // Function replacement, not a string: `removed` is full of `$` dollar-quote
  // tags and a string replacement would reinterpret `$&`/`$'`-style sequences.
  if (out.replace(NOTE, () => removed) !== sql) {
    throw new Error('refusing to emit: derived SQL differs from source outside the preflight block');
  }
  if (out.includes(OPEN)) throw new Error('refusing to emit: preflight block still present');

  return { out, removedLines: removed.split('\n').length };
}

// Only run the CLI when invoked directly, so the test can import build().
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { out, removedLines } = build(readFileSync(SOURCE, 'utf8'));
  const target = process.argv[2];
  if (target) {
    writeFileSync(target, out);
    process.stderr.write(`wrote ${target} (removed ${removedLines} lines of preflight)\n`);
  } else {
    process.stdout.write(out);
  }
}

export { build, SOURCE };
