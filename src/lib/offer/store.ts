// The offer: guarantees and offer moves from the sales excellence plan (the
// 48-hour fast fix, all-inclusive pricing, lease disclosure, the permanent
// labor warranty, the referral ask, the rebook lock, the permanent seed) as
// structured, versioned data, mirroring the playbook version pattern
// (src/lib/playbook/versions.ts) but global instead of per-vertical -- one
// offer applies across the whole business.
//
// PINNED CONTRACT: OfferElement / OfferContent below is read by sibling
// workstreams at runtime (the after-call scorer grades whether the rep said
// each element's customer_line per its grade_hint, the email drafter quotes
// customer_line directly). Do not change these field names without checking
// every consumer. DEFAULT_OFFER_CONTENT is the single source of truth for
// the seed data in code; supabase/migrations/0014_offer.sql embeds the same
// JSON so a fresh database has it from the start.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '../supabase';

export type OfferElement = {
  key: string;
  name: string;
  customer_line: string; // the exact line a rep says
  grade_hint: string; // plain-English instruction telling the scorer what counts as done
  applies_to: string; // 'all' | 'holiday' | 'permanent' | a comma-list of vertical slugs
  situational: boolean; // true = grade only when the moment fit, never on every call
  active: boolean;
};

export type OfferContent = {
  elements: OfferElement[];
  financing_note: string;
};

export type OfferSource = 'seeded' | 'edited';

// Row shape for the `offer_versions` table (see
// supabase/migrations/0014_offer.sql) -- only the columns the app reads.
export type OfferVersionRow = {
  id: string;
  version: number;
  content: OfferContent;
  source: OfferSource;
  created_at: string;
};

// The seven canonical keys other workstreams hardcode as their own
// fallback -- kept in one place so validateOfferContent and any consumer
// checking "is this a real offer" agree on the same list.
export const CANONICAL_OFFER_KEYS = [
  'fast_fix_48h',
  'all_inclusive',
  'lease_disclosure',
  'labor_warranty_3yr',
  'referral_ask',
  'rebook_lock',
  'permanent_seed',
] as const;

// Same seed as migration 0014's INSERT -- single source in code, the
// migration SQL embeds the same JSON so a fresh, not-yet-edited database
// serves identical content to this fallback.
export const DEFAULT_OFFER_CONTENT: OfferContent = {
  elements: [
    {
      key: 'fast_fix_48h',
      name: '48-Hour Fast Fix',
      customer_line:
        "If any section of your display goes dark between Thanksgiving and New Year's, we fix it within 48 hours or that month is free.",
      grade_hint: 'stated the 48-hour promise with its number on the call.',
      applies_to: 'holiday',
      situational: false,
      active: true,
    },
    {
      key: 'all_inclusive',
      name: 'All-Inclusive Pricing',
      customer_line:
        'Design, install, all-season service, takedown, storage, all in the number. The quote is the bill. No hidden fees.',
      grade_hint: 'said all-inclusive plainly, no fee surprises left open.',
      applies_to: 'all',
      situational: false,
      active: true,
    },
    {
      key: 'lease_disclosure',
      name: 'Lease Disclosure',
      customer_line:
        'We own the lights, store them, and reuse them every year. You are buying a done-for-you display, not hardware, and that is exactly why we can promise the 48-hour fix.',
      grade_hint: 'made ownership plain in one sentence, framed as the off-your-plate benefit.',
      applies_to: 'holiday',
      situational: false,
      active: true,
    },
    {
      key: 'labor_warranty_3yr',
      name: '3-Year Labor Warranty',
      customer_line:
        'Three years of labor coverage on the installation, not just parts. Most companies advertise lifetime parts and quietly cap labor at one year.',
      grade_hint: 'stated labor parity loudly as the differentiator.',
      applies_to: 'permanent',
      situational: false,
      active: true,
    },
    {
      key: 'referral_ask',
      name: 'Referral Ask',
      customer_line: '$100 credit for you, and your friend gets two free spritzers on us.',
      grade_hint: 'asked for the referral on a happy-customer call, not graded on a frustrated caller.',
      applies_to: 'all',
      situational: true,
      active: true,
    },
    {
      key: 'rebook_lock',
      name: 'Rebook Lock',
      customer_line:
        "Your spot and this year's price are held until [date]. One yes and you are on next year's schedule.",
      grade_hint: 'offered to lock next season at takedown or on a happy end-of-season call.',
      applies_to: 'holiday',
      situational: true,
      active: true,
    },
    {
      key: 'permanent_seed',
      name: 'Permanent Seed',
      customer_line:
        'Since our crew is already on your roofline, want them to measure for permanent lighting while they are up there? No cost, no commitment.',
      grade_hint:
        'planted only when the fit was there: past holiday customer, takedown call, ladder-averse homeowner. Grading it on every call is wrong.',
      applies_to: 'holiday',
      situational: true,
      active: true,
    },
  ],
  financing_note:
    'Wisetack financing is presented as a monthly number beside the cash price on permanent and genuine whole-home holiday only. Standard holiday stays cash and card, on purpose.',
};

export type ActiveOffer = {
  content: OfferContent;
  version: number | null;
  source: OfferSource | null;
};

// Consumers (the scorer, the email drafter) call this and always get a
// usable OfferContent back -- a missing table (migration not applied), an
// empty table, or any other read error all degrade to DEFAULT_OFFER_CONTENT
// rather than throwing, same philosophy as isSupabaseConfigured() degrading
// gracefully elsewhere in this codebase.
export async function getActiveOffer(supabase: SupabaseClient): Promise<ActiveOffer> {
  const { data, error } = await supabase
    .from('offer_versions')
    .select('version, content, source')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return { content: DEFAULT_OFFER_CONTENT, version: null, source: null };
  }

  const row = data as Pick<OfferVersionRow, 'version' | 'content' | 'source'>;
  return { content: row.content, version: row.version, source: row.source };
}

export type SaveOfferResult = { ok: true; version: number } | { ok: false; status: number; reason: string };

const UNIQUE_VIOLATION = '23505';
const MAX_ATTEMPTS = 2;
const COLLISION_REASON = 'Another change was saved at the same time. Please try again.';

// Reads the current highest version, inserts version+1 as 'edited', and
// retries once on a version-number collision with a concurrent save --
// same shape as publishPlaybookVersion (src/lib/playbook/versions.ts), just
// without a parent row to bump since offer_versions has no per-vertical
// active_version column to keep in sync.
export async function saveOfferEdit(supabase: SupabaseClient, content: OfferContent): Promise<SaveOfferResult> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { data: latest, error: readError } = await supabase
      .from('offer_versions')
      .select('version')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (readError) {
      if (isMissingTableError(readError)) {
        return { ok: false, status: 200, reason: 'Run migration 0014 first.' };
      }
      return { ok: false, status: 500, reason: 'Could not load the current offer version.' };
    }

    const currentVersion = (latest as Pick<OfferVersionRow, 'version'> | null)?.version ?? 0;
    const nextVersion = currentVersion + 1;

    const { error: insertError } = await supabase
      .from('offer_versions')
      .insert({ version: nextVersion, content, source: 'edited' });

    if (insertError) {
      if (insertError.code === UNIQUE_VIOLATION) {
        if (attempt < MAX_ATTEMPTS) continue;
        return { ok: false, status: 409, reason: COLLISION_REASON };
      }
      return { ok: false, status: 500, reason: 'Could not save the offer.' };
    }

    return { ok: true, version: nextVersion };
  }

  return { ok: false, status: 409, reason: COLLISION_REASON };
}

export type OfferValidationResult = { valid: true; content: OfferContent } | { valid: false; error: string };

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function isOfferElementShape(v: unknown): v is OfferElement {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isString(o.key) &&
    isString(o.name) &&
    isString(o.customer_line) &&
    isString(o.grade_hint) &&
    isString(o.applies_to) &&
    isBoolean(o.situational) &&
    isBoolean(o.active)
  );
}

// Hand-rolled validator, same convention as validatePlaybook
// (src/lib/playbook/validate.ts) -- no zod dependency. Checked before every
// save (and re-checked on rollback, since a stored version could in theory
// predate a later contract change): elements is a non-empty array, every
// element has all seven fields with the right types, keys are unique, the
// seven canonical keys are all present (extra custom elements are allowed
// on top), applies_to and customer_line are non-empty.
export function validateOfferContent(value: unknown): OfferValidationResult {
  if (typeof value !== 'object' || value === null) {
    return { valid: false, error: 'Offer content must be an object.' };
  }
  const v = value as Record<string, unknown>;

  if (!Array.isArray(v.elements) || v.elements.length === 0) {
    return { valid: false, error: 'elements must be a non-empty array.' };
  }
  if (!v.elements.every(isOfferElementShape)) {
    return {
      valid: false,
      error:
        'Every element needs key, name, customer_line, grade_hint, applies_to (strings), and situational, active (booleans).',
    };
  }
  const elements = v.elements as OfferElement[];

  for (const el of elements) {
    if (!el.customer_line.trim()) {
      return { valid: false, error: `Element "${el.key}" needs a non-empty customer_line.` };
    }
    if (!el.applies_to.trim()) {
      return { valid: false, error: `Element "${el.key}" needs a non-empty applies_to.` };
    }
  }

  const keys = elements.map(el => el.key);
  const duplicateKeys = [...new Set(keys.filter((key, i) => keys.indexOf(key) !== i))];
  if (duplicateKeys.length > 0) {
    return { valid: false, error: `Duplicate element keys: ${duplicateKeys.join(', ')}.` };
  }

  const missingCanonical = CANONICAL_OFFER_KEYS.filter(key => !keys.includes(key));
  if (missingCanonical.length > 0) {
    return { valid: false, error: `Missing required element keys: ${missingCanonical.join(', ')}.` };
  }

  if (!isString(v.financing_note)) {
    return { valid: false, error: 'financing_note must be a string.' };
  }

  return { valid: true, content: { elements, financing_note: v.financing_note } };
}
