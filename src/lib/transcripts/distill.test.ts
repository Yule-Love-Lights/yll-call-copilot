// Coverage for validateProposals — the H8 regression: current_value/
// proposed_value were typed `unknown` and passed through with a bare
// `?? null`, with no check against the per-section shape the system prompt
// itself promises (openers need {label,script}, objections need
// {objection,response}, everything else needs a plain string). A
// malformed proposed_value made apply.ts's add/change silently no-op while
// the decide route still marked the proposal approved. This is now
// rejected here, before a proposal is ever stored — reused verbatim by
// src/lib/analytics/brainReview.ts's validateReview.

import { describe, it, expect } from 'vitest';
import { validateProposals } from './distill';

function proposals(list: unknown[]) {
  return { proposals: list };
}

describe('validateProposals — per-section shape (H8)', () => {
  it('accepts a well-formed add for every section', () => {
    const result = validateProposals(
      proposals([
        { section: 'icp', kind: 'add', proposed_value: 'New ICP.', evidence: 'seen in 5 calls' },
        { section: 'voicemail', kind: 'add', proposed_value: 'New voicemail.', evidence: 'seen in 5 calls' },
        { section: 'angles', kind: 'add', proposed_value: 'Storm damage', evidence: 'seen in 5 calls' },
        { section: 'avoid', kind: 'add', proposed_value: 'Never do X', evidence: 'seen in 5 calls' },
        { section: 'openers', kind: 'add', proposed_value: { label: 'Cold', script: 'Hi there' }, evidence: 'seen in 5 calls' },
        { section: 'objections', kind: 'add', proposed_value: { objection: 'price', response: 'ok' }, evidence: 'seen in 5 calls' },
      ]),
    );
    expect(result.valid).toBe(true);
  });

  it('accepts a well-formed remove with proposed_value null', () => {
    const result = validateProposals(
      proposals([{ section: 'angles', kind: 'remove', current_value: 'Old angle', proposed_value: null, evidence: 'stopped landing' }]),
    );
    expect(result.valid).toBe(true);
  });

  it('accepts a well-formed remove that omits proposed_value entirely', () => {
    const result = validateProposals(
      proposals([{ section: 'openers', kind: 'remove', current_value: { label: 'Cold', script: 'x' }, evidence: 'stopped landing' }]),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects an add/change whose proposed_value is a bare string for openers (must be {label,script})', () => {
    const result = validateProposals(
      proposals([{ section: 'openers', kind: 'add', proposed_value: 'just a string', evidence: 'seen in 5 calls' }]),
    );
    expect(result.valid).toBe(false);
  });

  it('rejects an add/change whose proposed_value is missing the response field for objections', () => {
    const result = validateProposals(
      proposals([{ section: 'objections', kind: 'change', current_value: { objection: 'price', response: 'old' }, proposed_value: { objection: 'price' }, evidence: 'seen in 5 calls' }]),
    );
    expect(result.valid).toBe(false);
  });

  it('rejects an add/change whose proposed_value is a JSON-encoded string instead of a real object (the exact failure mode the system prompt warns against)', () => {
    const result = validateProposals(
      proposals([{ section: 'openers', kind: 'add', proposed_value: '{"label":"Cold","script":"Hi"}', evidence: 'seen in 5 calls' }]),
    );
    expect(result.valid).toBe(false);
  });

  it('rejects an add for a string section whose proposed_value is empty', () => {
    const result = validateProposals(proposals([{ section: 'icp', kind: 'add', proposed_value: '', evidence: 'seen in 5 calls' }]));
    expect(result.valid).toBe(false);
  });

  it('rejects a remove whose proposed_value is NOT null (contract violation, even though it would be ignored downstream)', () => {
    const result = validateProposals(
      proposals([{ section: 'angles', kind: 'remove', current_value: 'Old angle', proposed_value: 'should be null', evidence: 'x' }]),
    );
    expect(result.valid).toBe(false);
  });

  it('rejects the whole batch when even one proposal is malformed (all-or-nothing, feeds the existing retry)', () => {
    const result = validateProposals(
      proposals([
        { section: 'icp', kind: 'add', proposed_value: 'Fine.', evidence: 'seen in 5 calls' },
        { section: 'openers', kind: 'add', proposed_value: 'not an object', evidence: 'seen in 5 calls' },
      ]),
    );
    expect(result.valid).toBe(false);
  });
});
