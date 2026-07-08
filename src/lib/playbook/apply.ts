// Pure function that applies one playbook_proposals row onto a Playbook,
// producing the next playbook to save as a new version (source: 'edited').
// No I/O — POST /api/proposals/[id]/decide does the DB reads/writes; this
// function is the part worth unit-testing hard, since it's the one place a
// bad proposal could corrupt a live playbook.

import type { Playbook } from './types';
import type { ProposalKind, ProposalSection } from '../transcripts/types';

export type ProposalInput = {
  section: ProposalSection;
  kind: ProposalKind;
  current_value: unknown;
  proposed_value: unknown;
};

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

// Case/whitespace-insensitive key used to find "the same item" in an array
// even if the LLM's copy of current_value isn't byte-identical to what's
// stored (extra whitespace, minor casing).
function normKey(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

function applyToStringField(current: string, proposal: ProposalInput): string {
  if (proposal.kind === 'remove') return '';
  return asString(proposal.proposed_value, current);
}

function applyToStringArray(current: string[], proposal: ProposalInput): string[] {
  const proposedStr = typeof proposal.proposed_value === 'string' ? proposal.proposed_value : null;
  const currentKey = normKey(proposal.current_value);

  if (proposal.kind === 'add') {
    return proposedStr ? [...current, proposedStr] : current;
  }
  if (proposal.kind === 'remove') {
    return current.filter(item => normKey(item) !== currentKey);
  }

  // change: replace the first matching item; if nothing matched (the LLM's
  // current_value didn't line up with anything), append instead of
  // silently dropping the proposed change.
  let matched = false;
  const next = current.map(item => {
    if (!matched && normKey(item) === currentKey) {
      matched = true;
      return proposedStr ?? item;
    }
    return item;
  });
  if (!matched && proposedStr) next.push(proposedStr);
  return next;
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

function applyToOpeners(current: Opener[], proposal: ProposalInput): Opener[] {
  const proposedItem = isOpener(proposal.proposed_value) ? proposal.proposed_value : null;
  const currentKey = normKey(isOpener(proposal.current_value) ? proposal.current_value.label : proposal.current_value);

  if (proposal.kind === 'add') {
    return proposedItem ? [...current, proposedItem] : current;
  }
  if (proposal.kind === 'remove') {
    return current.filter(item => normKey(item.label) !== currentKey);
  }

  let matched = false;
  const next = current.map(item => {
    if (!matched && normKey(item.label) === currentKey) {
      matched = true;
      return proposedItem ?? item;
    }
    return item;
  });
  if (!matched && proposedItem) next.push(proposedItem);
  return next;
}

function isObjectionItem(v: unknown): v is ObjectionItem {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>).objection === 'string' &&
    typeof (v as Record<string, unknown>).response === 'string'
  );
}

function applyToObjections(current: ObjectionItem[], proposal: ProposalInput): ObjectionItem[] {
  const proposedItem = isObjectionItem(proposal.proposed_value) ? proposal.proposed_value : null;
  const currentKey = normKey(
    isObjectionItem(proposal.current_value) ? proposal.current_value.objection : proposal.current_value,
  );

  if (proposal.kind === 'add') {
    return proposedItem ? [...current, proposedItem] : current;
  }
  if (proposal.kind === 'remove') {
    return current.filter(item => normKey(item.objection) !== currentKey);
  }

  let matched = false;
  const next = current.map(item => {
    if (!matched && normKey(item.objection) === currentKey) {
      matched = true;
      return proposedItem ?? item;
    }
    return item;
  });
  if (!matched && proposedItem) next.push(proposedItem);
  return next;
}

export function applyProposal(playbook: Playbook, proposal: ProposalInput): Playbook {
  switch (proposal.section) {
    case 'icp':
      return { ...playbook, icp: applyToStringField(playbook.icp, proposal) };
    case 'voicemail':
      return { ...playbook, voicemail: applyToStringField(playbook.voicemail, proposal) };
    case 'angles':
      return { ...playbook, angles: applyToStringArray(playbook.angles, proposal) };
    case 'avoid':
      return { ...playbook, avoid: applyToStringArray(playbook.avoid, proposal) };
    case 'openers':
      return { ...playbook, openers: applyToOpeners(playbook.openers, proposal) };
    case 'objections':
      return { ...playbook, objections: applyToObjections(playbook.objections, proposal) };
    default:
      return playbook;
  }
}
