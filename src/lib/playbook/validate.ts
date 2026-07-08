// Hand-rolled shape validator for a Playbook — no zod dependency, per Phase 1
// constraints. Used server-side before PUT /api/verticals/[id]/playbook ever
// stores a human-edited (or restored) playbook as a new version.

import type { Playbook } from './types';

export type PlaybookValidationResult =
  | { valid: true; playbook: Playbook }
  | { valid: false; error: string };

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}

function isOpenerArray(v: unknown): v is Playbook['openers'] {
  return (
    Array.isArray(v) &&
    v.every(
      o =>
        typeof o === 'object' &&
        o !== null &&
        isString((o as Record<string, unknown>).label) &&
        isString((o as Record<string, unknown>).script),
    )
  );
}

function isObjectionArray(v: unknown): v is Playbook['objections'] {
  return (
    Array.isArray(v) &&
    v.every(
      o =>
        typeof o === 'object' &&
        o !== null &&
        isString((o as Record<string, unknown>).objection) &&
        isString((o as Record<string, unknown>).response),
    )
  );
}

// generate.ts's system prompt mandates these five opener labels exactly and
// at least these five objection categories — isOpenerArray/isObjectionArray
// above only checked each element's shape, never that the required set was
// actually covered, so a playbook with (say) just 3 openers or two
// duplicate "Cold" scripts passed validation and saved as the active
// version with no warning, quietly missing a mandated call scenario.
const REQUIRED_OPENER_LABELS = ['Inbound follow-up', 'Past customer', 'Quote follow-up', 'Neighbor install / referral', 'Cold'];

// Objections don't have a fixed label like openers do — each is a free-text
// { objection, response } pair — so each category is matched against a
// small set of the words the system prompt itself uses for it, case-
// insensitive substring match (same contains strategy as opener labels).
const REQUIRED_OBJECTION_CATEGORIES: { name: string; keywords: string[] }[] = [
  { name: 'price', keywords: ['price'] },
  { name: 'not interested', keywords: ['not interested'] },
  { name: 'email me info', keywords: ['email'] },
  { name: 'spouse or other decision-maker', keywords: ['spouse', 'decision'] },
  { name: 'bad timing', keywords: ['timing', 'bad time'] },
];

function containsCaseInsensitive(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function missingOpenerLabels(openers: Playbook['openers']): string[] {
  return REQUIRED_OPENER_LABELS.filter(required => !openers.some(o => containsCaseInsensitive(o.label, required)));
}

function missingObjectionCategories(objections: Playbook['objections']): string[] {
  return REQUIRED_OBJECTION_CATEGORIES.filter(
    category => !objections.some(o => category.keywords.some(keyword => containsCaseInsensitive(o.objection, keyword))),
  ).map(category => category.name);
}

export function validatePlaybook(value: unknown): PlaybookValidationResult {
  if (typeof value !== 'object' || value === null) {
    return { valid: false, error: 'Playbook must be an object.' };
  }
  const v = value as Record<string, unknown>;

  if (!isString(v.icp)) {
    return { valid: false, error: 'icp must be a string.' };
  }
  if (!isStringArray(v.angles)) {
    return { valid: false, error: 'angles must be an array of strings.' };
  }
  if (!isOpenerArray(v.openers)) {
    return { valid: false, error: 'openers must be an array of { label, script } strings.' };
  }
  const missingOpeners = missingOpenerLabels(v.openers);
  if (missingOpeners.length > 0) {
    return { valid: false, error: `openers is missing required labels: ${missingOpeners.join(', ')}.` };
  }
  if (!isObjectionArray(v.objections)) {
    return { valid: false, error: 'objections must be an array of { objection, response } strings.' };
  }
  const missingObjections = missingObjectionCategories(v.objections);
  if (missingObjections.length > 0) {
    return { valid: false, error: `objections is missing required categories: ${missingObjections.join(', ')}.` };
  }
  if (!isStringArray(v.avoid)) {
    return { valid: false, error: 'avoid must be an array of strings.' };
  }
  if (!isString(v.voicemail)) {
    return { valid: false, error: 'voicemail must be a string.' };
  }

  return {
    valid: true,
    playbook: {
      icp: v.icp,
      angles: v.angles,
      openers: v.openers,
      objections: v.objections,
      avoid: v.avoid,
      voicemail: v.voicemail,
    },
  };
}
