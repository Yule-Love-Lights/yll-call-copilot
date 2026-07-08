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
  if (!isObjectionArray(v.objections)) {
    return { valid: false, error: 'objections must be an array of { objection, response } strings.' };
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
