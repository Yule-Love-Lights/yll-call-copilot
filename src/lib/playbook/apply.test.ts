// Hard coverage for applyProposal — add/change/remove across every section
// type (single string, string array, and object array), since a bad
// proposal here would corrupt a live playbook.

import { describe, it, expect } from 'vitest';
import { applyProposal, type ProposalInput } from './apply';
import type { Playbook } from './types';

function basePlaybook(): Playbook {
  return {
    icp: 'Homeowners with existing holiday lighting.',
    angles: ['Past customer renewal', 'Neighbor referral'],
    openers: [
      { label: 'Past customer', script: 'Hi, this is Yule Love Lights.' },
      { label: 'Cold', script: 'Hi, this is a local lighting company.' },
    ],
    objections: [
      { objection: 'price', response: 'Let me walk through what is included.' },
      { objection: 'not interested', response: 'No problem, thanks for your time.' },
    ],
    avoid: ['Never pressure a homeowner into deciding on the spot.'],
    voicemail: 'Hi, this is Yule Love Lights, give us a call back.',
  };
}

function proposal(overrides: Partial<ProposalInput>): ProposalInput {
  return {
    section: 'icp',
    kind: 'change',
    current_value: null,
    proposed_value: null,
    ...overrides,
  };
}

describe('applyProposal — icp (single string)', () => {
  it('change replaces the string', () => {
    const result = applyProposal(
      basePlaybook(),
      proposal({ section: 'icp', kind: 'change', current_value: basePlaybook().icp, proposed_value: 'Past customers only.' }),
    );
    expect(result.icp).toBe('Past customers only.');
  });

  it('add sets the string (there is only ever one icp)', () => {
    const result = applyProposal(basePlaybook(), proposal({ section: 'icp', kind: 'add', proposed_value: 'New ICP.' }));
    expect(result.icp).toBe('New ICP.');
  });

  it('remove clears the string', () => {
    const result = applyProposal(basePlaybook(), proposal({ section: 'icp', kind: 'remove', current_value: basePlaybook().icp }));
    expect(result.icp).toBe('');
  });
});

describe('applyProposal — voicemail (single string)', () => {
  it('change replaces the script', () => {
    const result = applyProposal(
      basePlaybook(),
      proposal({ section: 'voicemail', kind: 'change', proposed_value: 'New voicemail script.' }),
    );
    expect(result.voicemail).toBe('New voicemail script.');
  });

  it('remove clears the script', () => {
    const result = applyProposal(basePlaybook(), proposal({ section: 'voicemail', kind: 'remove' }));
    expect(result.voicemail).toBe('');
  });
});

describe('applyProposal — angles (string array)', () => {
  it('add appends a new angle', () => {
    const result = applyProposal(basePlaybook(), proposal({ section: 'angles', kind: 'add', proposed_value: 'Storm damage repair' }));
    expect(result.angles).toEqual(['Past customer renewal', 'Neighbor referral', 'Storm damage repair']);
  });

  it('change replaces the matching angle in place', () => {
    const result = applyProposal(
      basePlaybook(),
      proposal({ section: 'angles', kind: 'change', current_value: 'Neighbor referral', proposed_value: 'Neighbor install referral' }),
    );
    expect(result.angles).toEqual(['Past customer renewal', 'Neighbor install referral']);
  });

  it('change is case/whitespace insensitive when matching current_value', () => {
    const result = applyProposal(
      basePlaybook(),
      proposal({ section: 'angles', kind: 'change', current_value: '  NEIGHBOR REFERRAL  ', proposed_value: 'Updated angle' }),
    );
    expect(result.angles).toEqual(['Past customer renewal', 'Updated angle']);
  });

  it('change appends instead of dropping the edit when nothing matches current_value', () => {
    const result = applyProposal(
      basePlaybook(),
      proposal({ section: 'angles', kind: 'change', current_value: 'Does not exist', proposed_value: 'New angle' }),
    );
    expect(result.angles).toEqual(['Past customer renewal', 'Neighbor referral', 'New angle']);
  });

  it('remove drops the matching angle', () => {
    const result = applyProposal(
      basePlaybook(),
      proposal({ section: 'angles', kind: 'remove', current_value: 'Past customer renewal' }),
    );
    expect(result.angles).toEqual(['Neighbor referral']);
  });
});

describe('applyProposal — avoid (string array)', () => {
  it('add appends', () => {
    const result = applyProposal(basePlaybook(), proposal({ section: 'avoid', kind: 'add', proposed_value: 'Never badmouth a competitor.' }));
    expect(result.avoid).toEqual(['Never pressure a homeowner into deciding on the spot.', 'Never badmouth a competitor.']);
  });

  it('remove drops the matching item', () => {
    const result = applyProposal(
      basePlaybook(),
      proposal({ section: 'avoid', kind: 'remove', current_value: 'Never pressure a homeowner into deciding on the spot.' }),
    );
    expect(result.avoid).toEqual([]);
  });
});

describe('applyProposal — openers (object array, matched by label)', () => {
  it('add appends a new opener', () => {
    const result = applyProposal(
      basePlaybook(),
      proposal({
        section: 'openers',
        kind: 'add',
        proposed_value: { label: 'Quote follow-up', script: 'Hi, following up on your quote.' },
      }),
    );
    expect(result.openers).toHaveLength(3);
    expect(result.openers[2]).toEqual({ label: 'Quote follow-up', script: 'Hi, following up on your quote.' });
  });

  it('change replaces the opener matching current_value.label', () => {
    const result = applyProposal(
      basePlaybook(),
      proposal({
        section: 'openers',
        kind: 'change',
        current_value: { label: 'Cold', script: 'Hi, this is a local lighting company.' },
        proposed_value: { label: 'Cold', script: 'Hi, we just finished an install down your street.' },
      }),
    );
    expect(result.openers).toEqual([
      { label: 'Past customer', script: 'Hi, this is Yule Love Lights.' },
      { label: 'Cold', script: 'Hi, we just finished an install down your street.' },
    ]);
  });

  it('remove drops the opener matching current_value.label', () => {
    const result = applyProposal(
      basePlaybook(),
      proposal({ section: 'openers', kind: 'remove', current_value: { label: 'Cold', script: 'anything' } }),
    );
    expect(result.openers).toEqual([{ label: 'Past customer', script: 'Hi, this is Yule Love Lights.' }]);
  });
});

describe('applyProposal — objections (object array, matched by objection text)', () => {
  it('add appends a new objection', () => {
    const result = applyProposal(
      basePlaybook(),
      proposal({
        section: 'objections',
        kind: 'add',
        proposed_value: { objection: 'bad timing', response: 'No worries, when is better?' },
      }),
    );
    expect(result.objections).toHaveLength(3);
    expect(result.objections[2]).toEqual({ objection: 'bad timing', response: 'No worries, when is better?' });
  });

  it('change replaces the objection matching current_value.objection', () => {
    const result = applyProposal(
      basePlaybook(),
      proposal({
        section: 'objections',
        kind: 'change',
        current_value: { objection: 'price', response: 'old response' },
        proposed_value: { objection: 'price', response: 'Updated response with the early-bird discount.' },
      }),
    );
    expect(result.objections[0]).toEqual({ objection: 'price', response: 'Updated response with the early-bird discount.' });
    expect(result.objections[1]).toEqual({ objection: 'not interested', response: 'No problem, thanks for your time.' });
  });

  it('remove drops the objection matching current_value.objection', () => {
    const result = applyProposal(
      basePlaybook(),
      proposal({ section: 'objections', kind: 'remove', current_value: { objection: 'not interested', response: 'anything' } }),
    );
    expect(result.objections).toEqual([{ objection: 'price', response: 'Let me walk through what is included.' }]);
  });
});

describe('applyProposal — immutability', () => {
  it('does not mutate the input playbook', () => {
    const original = basePlaybook();
    const originalAngles = [...original.angles];

    applyProposal(original, proposal({ section: 'angles', kind: 'add', proposed_value: 'New angle' }));

    expect(original.angles).toEqual(originalAngles);
  });

  it('returns a different object reference', () => {
    const original = basePlaybook();
    const result = applyProposal(original, proposal({ section: 'icp', kind: 'change', proposed_value: 'x' }));
    expect(result).not.toBe(original);
  });
});
