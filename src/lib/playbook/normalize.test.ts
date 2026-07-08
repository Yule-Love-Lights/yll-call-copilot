// Coverage for normalizePlaybookInput: the two live-seen recovery cases
// (JSON-encoded-string fields, XML-tagged item strings) plus passthrough.

import { describe, it, expect } from 'vitest';
import { normalizePlaybookInput } from './normalize';

describe('normalizePlaybookInput', () => {
  it('parses array fields that arrive as JSON-encoded strings', () => {
    const out = normalizePlaybookInput({
      icp: 'x',
      angles: '["a","b"]',
      openers: '[{"label":"Cold","script":"hi"}]',
      objections: '[{"objection":"price","response":"ok"}]',
      avoid: '["never"]',
      voicemail: 'v',
    }) as Record<string, unknown>;

    expect(out.angles).toEqual(['a', 'b']);
    expect(out.openers).toEqual([{ label: 'Cold', script: 'hi' }]);
    expect(out.objections).toEqual([{ objection: 'price', response: 'ok' }]);
    expect(out.avoid).toEqual(['never']);
  });

  it('extracts items wrapped in repeated XML tags (the live failure)', () => {
    const out = normalizePlaybookInput({
      angles: '\n<angle>Early bird booking</angle>\n<angle>Same design as last year</angle>\n',
      avoid: '<item>Never pressure</item>',
    }) as Record<string, unknown>;

    expect(out.angles).toEqual(['Early bird booking', 'Same design as last year']);
    expect(out.avoid).toEqual(['Never pressure']);
  });

  it('leaves well-formed input untouched', () => {
    const good = {
      icp: 'x',
      angles: ['a'],
      openers: [{ label: 'Cold', script: 'hi' }],
      objections: [{ objection: 'price', response: 'ok' }],
      avoid: ['never'],
      voicemail: 'v',
    };
    expect(normalizePlaybookInput(good)).toEqual(good);
  });

  it('leaves unrecoverable strings alone so validation can reject them', () => {
    const out = normalizePlaybookInput({ angles: 'just prose, no tags' }) as Record<string, unknown>;
    expect(out.angles).toBe('just prose, no tags');
  });

  it('unwraps arrays of one-key string objects (the event-vertical live failure)', () => {
    const out = normalizePlaybookInput({
      angles: [{ angle: 'Early bird booking' }, { angle: 'Rebook season' }],
      avoid: [{ text: 'Never pressure' }, { value: 'No fake urgency' }],
    }) as Record<string, unknown>;

    expect(out.angles).toEqual(['Early bird booking', 'Rebook season']);
    expect(out.avoid).toEqual(['Never pressure', 'No fake urgency']);
  });

  it('leaves object arrays alone when any element cannot unwrap to a string', () => {
    const mixed = [{ angle: 'ok' }, { angle: 42 }];
    const out = normalizePlaybookInput({ angles: mixed }) as Record<string, unknown>;
    expect(out.angles).toEqual(mixed);
  });

  it('never unwraps the openers/objections object arrays', () => {
    const openers = [{ label: 'Cold', script: 'hi' }];
    const out = normalizePlaybookInput({ openers }) as Record<string, unknown>;
    expect(out.openers).toEqual(openers);
  });
});
