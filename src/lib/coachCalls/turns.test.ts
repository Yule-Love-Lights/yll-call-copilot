import { describe, it, expect } from 'vitest';
import { splitRawTextIntoTurns } from './turns';

describe('splitRawTextIntoTurns', () => {
  it('splits "Name: text" turns separated by a blank line', () => {
    const raw = 'Rep: Hi, this is Jake, how can I help?\n\nCustomer: I saw your lights next door.\n\n';
    expect(splitRawTextIntoTurns(raw)).toEqual([
      { speaker: 'Rep', text: 'Hi, this is Jake, how can I help?' },
      { speaker: 'Customer', text: 'I saw your lights next door.' },
    ]);
  });

  it('splits "Speaker 0: text" turns (the RingCentral reconstruction shape)', () => {
    const raw = 'Speaker 0: Thanks for calling.\n\nSpeaker 1: No problem, thanks.';
    expect(splitRawTextIntoTurns(raw)).toEqual([
      { speaker: 'Speaker 0', text: 'Thanks for calling.' },
      { speaker: 'Speaker 1', text: 'No problem, thanks.' },
    ]);
  });

  it('keeps a line with no colon as an unattributed turn', () => {
    const raw = 'Rep: Hello there.\n\njust some stray text with no label\n\nCustomer: hi';
    expect(splitRawTextIntoTurns(raw)).toEqual([
      { speaker: 'Rep', text: 'Hello there.' },
      { speaker: null, text: 'just some stray text with no label' },
      { speaker: 'Customer', text: 'hi' },
    ]);
  });

  it('tolerates extra blank lines and CRLF between turns', () => {
    const raw = 'Rep: hi\r\n\r\n\r\nCustomer: hello\r\n';
    expect(splitRawTextIntoTurns(raw)).toEqual([
      { speaker: 'Rep', text: 'hi' },
      { speaker: 'Customer', text: 'hello' },
    ]);
  });

  it('keeps a multi-line turn body under one label', () => {
    const raw = 'Rep: first line\nsecond line still the rep\n\nCustomer: ok';
    expect(splitRawTextIntoTurns(raw)).toEqual([
      { speaker: 'Rep', text: 'first line\nsecond line still the rep' },
      { speaker: 'Customer', text: 'ok' },
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(splitRawTextIntoTurns('')).toEqual([]);
    expect(splitRawTextIntoTurns('   \n\n  ')).toEqual([]);
  });
});
