// Coverage for the RingCentral filename-date parser, the turn parser, the
// junk/IVR detector, and pickCustomerName. Fixtures under
// fixtures/ringcentral/ are entirely synthetic (fake names, fake but
// realistic holiday-lighting dialogue) -- see the module comment in
// ringcentral.ts for why: no real transcript content or customer names may
// ever land in this repo.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isLikelyJunk,
  junkReason,
  looksLikeRingCentralTranscript,
  parseRingCentralFilenameDate,
  parseRingCentralTranscript,
  pickCustomerName,
} from './ringcentral';

const FIXTURES_DIR = join(process.cwd(), 'fixtures', 'ringcentral');

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf8');
}

describe('parseRingCentralFilenameDate', () => {
  it('parses a 1-digit hour', () => {
    // 10 Dec 2025 3:36 PM ET is EST (UTC-5) -- DST ended the first Sunday
    // of November.
    expect(parseRingCentralFilenameDate('10_Dec_2025_3_36_PM_transcript.txt')).toBe('2025-12-10T20:36:00.000Z');
  });

  it('parses a 2-digit hour', () => {
    // 10 Nov 2025 10:02 AM ET -- also EST (DST ended 2 Nov 2025).
    expect(parseRingCentralFilenameDate('10_Nov_2025_10_02_AM_transcript.txt')).toBe('2025-11-10T15:02:00.000Z');
  });

  it('converts 12 AM to midnight and 12 PM to noon', () => {
    expect(parseRingCentralFilenameDate('1_Jan_2026_12_00_AM_transcript.txt')).toBe('2026-01-01T05:00:00.000Z');
    expect(parseRingCentralFilenameDate('1_Jan_2026_12_00_PM_transcript.txt')).toBe('2026-01-01T17:00:00.000Z');
  });

  it('accounts for daylight saving time (EDT, UTC-4) in summer', () => {
    // 15 Jul 2025 is EDT.
    expect(parseRingCentralFilenameDate('15_Jul_2025_2_30_PM_transcript.txt')).toBe('2025-07-15T18:30:00.000Z');
  });

  it('handles every month abbreviation', () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (const mon of months) {
      expect(parseRingCentralFilenameDate(`5_${mon}_2025_9_00_AM_transcript.txt`)).not.toBeNull();
    }
  });

  it('tolerates the " (1)" duplicate-download suffix', () => {
    expect(parseRingCentralFilenameDate('12_Apr_2026_11_25_AM_transcript (1).txt')).toBe(
      parseRingCentralFilenameDate('12_Apr_2026_11_25_AM_transcript.txt'),
    );
  });

  it('returns null for a filename with no date shape', () => {
    expect(parseRingCentralFilenameDate('not-a-ringcentral-file.txt')).toBeNull();
    expect(parseRingCentralFilenameDate('call-01-header-booked.txt')).toBeNull();
  });

  it('returns null for an unrecognized month abbreviation', () => {
    expect(parseRingCentralFilenameDate('10_Xyz_2025_3_36_PM_transcript.txt')).toBeNull();
  });
});

describe('looksLikeRingCentralTranscript', () => {
  it('detects the turn-header shape', () => {
    expect(looksLikeRingCentralTranscript(readFixture('10_Dec_2025_3_36_PM_transcript.txt'))).toBe(true);
  });

  it('returns false for a plain header-block .txt', () => {
    expect(looksLikeRingCentralTranscript('Name: Karen\nPhone: 555-1234\n\nRep: hi\nCustomer: hello')).toBe(false);
  });
});

describe('parseRingCentralTranscript', () => {
  it('splits turns, dedups speakers in order, and reconstructs speaker-labelled raw_text', () => {
    const filename = '10_Dec_2025_3_36_PM_transcript.txt';
    const parsed = parseRingCentralTranscript(filename, readFixture(filename));

    expect(parsed.called_at).toBe('2025-12-10T20:36:00.000Z');
    expect(parsed.speakers).toEqual(['Jamie Rivera', 'Casey Thompson']);
    expect(parsed.turns).toHaveLength(8);
    expect(parsed.turns[0]).toEqual({
      speaker: 'Jamie Rivera',
      text: 'Hi, this is Jamie from Yule Love Lights. Am I speaking with Casey?',
    });
    // Leading spaces on continuation turns are trimmed.
    expect(parsed.turns[1].text).toBe('Yes, this is Casey.');
    expect(parsed.raw_text).toContain('Jamie Rivera: Hi, this is Jamie from Yule Love Lights');
    expect(parsed.raw_text).toContain('Casey Thompson: Yes, this is Casey.');
    // The per-turn date stamp is dropped from the reconstructed raw_text.
    expect(parsed.raw_text).not.toContain('|');
    expect(parsed.wordCount).toBeGreaterThan(20);
  });

  it('tolerates a blank turn (a header immediately followed by another header)', () => {
    const text = [
      'Jamie Rivera | 1 Jan 2026 9:00 AM',
      'Rep A | 1 Jan 2026 9:00 AM',
      'Hello there, this is a real turn with more than a couple words in it.',
      '',
    ].join('\n');
    const parsed = parseRingCentralTranscript('1_Jan_2026_9_00_AM_transcript.txt', text);
    expect(parsed.turns[0]).toEqual({ speaker: 'Jamie Rivera', text: '' });
    expect(parsed.turns[1].speaker).toBe('Rep A');
  });

  it('ignores stray text before the first header', () => {
    const text = ['some preamble line', 'Rep A | 1 Jan 2026 9:00 AM', 'Hi there.'].join('\n');
    const parsed = parseRingCentralTranscript('1_Jan_2026_9_00_AM_transcript.txt', text);
    expect(parsed.turns).toHaveLength(1);
    expect(parsed.turns[0].text).toBe('Hi there.');
  });

  it('returns called_at null when the filename does not parse', () => {
    const parsed = parseRingCentralTranscript('weird-name.txt', 'Rep A | 1 Jan 2026 9:00 AM\nHi.');
    expect(parsed.called_at).toBeNull();
  });
});

describe('junkReason / isLikelyJunk', () => {
  it('flags a single-speaker file (pure IVR announcement)', () => {
    const filename = '12_Dec_2025_9_05_AM_transcript.txt';
    const parsed = parseRingCentralTranscript(filename, readFixture(filename));
    expect(parsed.speakers).toHaveLength(1);
    expect(junkReason(parsed)).toBe('single_speaker');
    expect(isLikelyJunk(parsed)).toBe(true);
  });

  it('flags a too-short exchange', () => {
    const filename = '13_Dec_2025_1_10_PM_transcript.txt';
    const parsed = parseRingCentralTranscript(filename, readFixture(filename));
    expect(junkReason(parsed)).toBe('too_short');
  });

  it('flags a voicemail drop where one speaker never says anything but automated text', () => {
    const filename = '11_Dec_2025_4_15_PM_transcript.txt';
    const parsed = parseRingCentralTranscript(filename, readFixture(filename));
    expect(parsed.speakers).toHaveLength(2); // "2 distinct speakers" alone must not save it
    expect(parsed.wordCount).toBeGreaterThanOrEqual(20); // nor word count alone
    expect(junkReason(parsed)).toBe('automated_speaker');
  });

  it('does NOT flag a real conversation that opens with an auto-attendant line before a human picks up', () => {
    // Regression case: a real, long exchange where the FIRST turn happens
    // to contain IVR-shaped phrasing must not get nuked by a whole-body
    // substring scan -- only a speaker whose EVERY turn is automated does.
    const text = [
      'Casey Thompson | 1 Jan 2026 9:00 AM',
      'Hi, if you record your name and reason for calling, I will see if this person is available.',
      '',
      'Jamie Rivera | 1 Jan 2026 9:00 AM',
      'Hi Casey, this is Jamie from Yule Love Lights following up on your quote request.',
      '',
      'Casey Thompson | 1 Jan 2026 9:01 AM',
      'Oh hi, yes, I have been meaning to call you back about the roofline pricing.',
      '',
      'Jamie Rivera | 1 Jan 2026 9:01 AM',
      'Great, let us go over it now if you have a few minutes.',
      '',
      'Casey Thompson | 1 Jan 2026 9:01 AM',
      'Sure, go ahead, I am ready to book if the price works.',
    ].join('\n');
    const parsed = parseRingCentralTranscript('1_Jan_2026_9_00_AM_transcript.txt', text);
    expect(junkReason(parsed)).toBeNull();
    expect(isLikelyJunk(parsed)).toBe(false);
  });

  it('does not flag a real short call with no IVR phrasing', () => {
    const filename = '10_Dec_2025_3_36_PM_transcript.txt';
    const parsed = parseRingCentralTranscript(filename, readFixture(filename));
    expect(junkReason(parsed)).toBeNull();
  });
});

describe('pickCustomerName', () => {
  it('picks the single non-rep speaker', () => {
    const filename = '10_Dec_2025_3_36_PM_transcript.txt';
    const parsed = parseRingCentralTranscript(filename, readFixture(filename));
    const repNames = new Set(['Jamie Rivera']);
    expect(pickCustomerName(parsed, repNames)).toBe('Casey Thompson');
  });

  it('returns null when every speaker is a rep', () => {
    const filename = '10_Dec_2025_3_36_PM_transcript.txt';
    const parsed = parseRingCentralTranscript(filename, readFixture(filename));
    const repNames = new Set(['Jamie Rivera', 'Casey Thompson']);
    expect(pickCustomerName(parsed, repNames)).toBeNull();
  });

  it('returns null when more than one speaker is a non-rep (ambiguous)', () => {
    const filename = '14_Dec_2025_2_20_PM_transcript.txt';
    const parsed = parseRingCentralTranscript(filename, readFixture(filename));
    const repNames = new Set(['Jamie Rivera']);
    expect(parsed.speakers).toHaveLength(3);
    expect(pickCustomerName(parsed, repNames)).toBeNull();
  });
});
