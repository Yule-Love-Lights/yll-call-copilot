// Pure function that applies one playbook_proposals row onto a Playbook,
// producing the next playbook to save as a new version (source: 'edited').
// No I/O here — POST /api/proposals/[id]/decide does the DB reads/writes;
// this function is the part worth unit-testing hard, since it's the one
// place a bad proposal could corrupt a live playbook.
//
// Returns {applied, playbook} on success or {applied:false, reason} when
// the proposal's proposed_value didn't match the section's expected shape
// (an add/change that would otherwise silently no-op) or a change/remove's
// current_value matched nothing (nothing to change or remove) — the caller
// must only mark the proposal approved when applied is true (see the H8/M4
// review findings: distill.ts's validateProposals now also rejects a
// malformed shape before a proposal is ever stored, so this is defense in
// depth against an already-stored proposal from before that fix, or any
// other source).

import type { Playbook } from './types';
import type { ProposalKind, ProposalSection } from '../transcripts/types';

export type ProposalInput = {
  section: ProposalSection;
  kind: ProposalKind;
  current_value: unknown;
  proposed_value: unknown;
};

export type ApplyProposalResult = { applied: true; playbook: Playbook } | { applied: false; reason: string };

// Case/whitespace-insensitive key used to find "the same item" in an array
// even if the LLM's copy of current_value isn't byte-identical to what's
// stored (extra whitespace, minor casing).
function normKey(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

type FieldResult<T> = { applied: true; value: T } | { applied: false; reason: string };

function applyToStringField(current: string, proposal: ProposalInput): FieldResult<string> {
  if (proposal.kind === 'remove') return { applied: true, value: '' };
  if (typeof proposal.proposed_value !== 'string' || !proposal.proposed_value.trim()) {
    return { applied: false, reason: `proposed_value for section "${proposal.section}" must be a non-empty string.` };
  }
  return { applied: true, value: proposal.proposed_value };
}

function applyToStringArray(current: string[], proposal: ProposalInput): FieldResult<string[]> {
  const proposedStr = typeof proposal.proposed_value === 'string' ? proposal.proposed_value : null;
  const currentKey = normKey(proposal.current_value);

  if (proposal.kind === 'add') {
    if (!proposedStr) return { applied: false, reason: `proposed_value for section "${proposal.section}" must be a non-empty string to add.` };
    return { applied: true, value: [...current, proposedStr] };
  }
  if (proposal.kind === 'remove') {
    const next = current.filter(item => normKey(item) !== currentKey);
    if (next.length === current.length) {
      return { applied: false, reason: `Could not find an item matching current_value to remove from "${proposal.section}".` };
    }
    return { applied: true, value: next };
  }

  // change: replace the first matching item; if nothing matched (the LLM's
  // current_value didn't line up with anything), append instead of
  // silently dropping the proposed change.
  if (!proposedStr) return { applied: false, reason: `proposed_value for section "${proposal.section}" must be a non-empty string.` };
  let matched = false;
  const next = current.map(item => {
    if (!matched && normKey(item) === currentKey) {
      matched = true;
      return proposedStr;
    }
    return item;
  });
  if (!matched) next.push(proposedStr);
  return { applied: true, value: next };
}

type Opener = Playbook['openers'][number];
type ObjectionItem = Playbook['objections'][number];

function isOpener(v: unknown): v is Opener {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>).label === 'string' &&
    typeof (v as Record<string, unknown>).script === 'string'
  );
}

function applyToOpeners(current: Opener[], proposal: ProposalInput): FieldResult<Opener[]> {
  const proposedItem = isOpener(proposal.proposed_value) ? proposal.proposed_value : null;
  const currentKey = normKey(isOpener(proposal.current_value) ? proposal.current_value.label : proposal.current_value);

  if (proposal.kind === 'add') {
    if (!proposedItem) return { applied: false, reason: 'proposed_value for openers must be a { label, script } object.' };
    return { applied: true, value: [...current, proposedItem] };
  }
  if (proposal.kind === 'remove') {
    const next = current.filter(item => normKey(item.label) !== currentKey);
    if (next.length === current.length) {
      return { applied: false, reason: 'Could not find an opener matching current_value to remove.' };
    }
    return { applied: true, value: next };
  }

  if (!proposedItem) return { applied: false, reason: 'proposed_value for openers must be a { label, script } object.' };
  let matched = false;
  const next = current.map(item => {
    if (!matched && normKey(item.label) === currentKey) {
      matched = true;
      return proposedItem;
    }
    return item;
  });
  if (!matched) next.push(proposedItem);
  return { applied: true, value: next };
}

function isObjectionItem(v: unknown): v is ObjectionItem {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>).objection === 'string' &&
    typeof (v as Record<string, unknown>).response === 'string'
  );
}

function applyToObjections(current: ObjectionItem[], proposal: ProposalInput): FieldResult<ObjectionItem[]> {
  const proposedItem = isObjectionItem(proposal.proposed_value) ? proposal.proposed_value : null;
  const currentKey = normKey(
    isObjectionItem(proposal.current_value) ? proposal.current_value.objection : proposal.current_value,
  );

  if (proposal.kind === 'add') {
    if (!proposedItem) return { applied: false, reason: 'proposed_value for objections must be a { objection, response } object.' };
    return { applied: true, value: [...current, proposedItem] };
  }
  if (proposal.kind === 'remove') {
    const next = current.filter(item => normKey(item.objection) !== currentKey);
    if (next.length === current.length) {
      return { applied: false, reason: 'Could not find an objection matching current_value to remove.' };
    }
    return { applied: true, value: next };
  }

  if (!proposedItem) return { applied: false, reason: 'proposed_value for objections must be a { objection, response } object.' };
  let matched = false;
  const next = current.map(item => {
    if (!matched && normKey(item.objection) === currentKey) {
      matched = true;
      return proposedItem;
    }
    return item;
  });
  if (!matched) next.push(proposedItem);
  return { applied: true, value: next };
}

export function applyProposal(playbook: Playbook, proposal: ProposalInput): ApplyProposalResult {
  switch (proposal.section) {
    case 'icp': {
      const result = applyToStringField(playbook.icp, proposal);
      return result.applied ? { applied: true, playbook: { ...playbook, icp: result.value } } : { applied: false, reason: result.reason };
    }
    case 'voicemail': {
      const result = applyToStringField(playbook.voicemail, proposal);
      return result.applied
        ? { applied: true, playbook: { ...playbook, voicemail: result.value } }
        : { applied: false, reason: result.reason };
    }
    case 'angles': {
      const result = applyToStringArray(playbook.angles, proposal);
      return result.applied
        ? { applied: true, playbook: { ...playbook, angles: result.value } }
        : { applied: false, reason: result.reason };
    }
    case 'avoid': {
      const result = applyToStringArray(playbook.avoid, proposal);
      return result.applied
        ? { applied: true, playbook: { ...playbook, avoid: result.value } }
        : { applied: false, reason: result.reason };
    }
    case 'openers': {
      const result = applyToOpeners(playbook.openers, proposal);
      return result.applied
        ? { applied: true, playbook: { ...playbook, openers: result.value } }
        : { applied: false, reason: result.reason };
    }
    case 'objections': {
      const result = applyToObjections(playbook.objections, proposal);
      return result.applied
        ? { applied: true, playbook: { ...playbook, objections: result.value } }
        : { applied: false, reason: result.reason };
    }
    default:
      return { applied: false, reason: `Unknown playbook section "${proposal.section as string}".` };
  }
}
