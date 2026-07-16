// Coverage for the second-mile message templates -- plain deterministic
// string builders, no Claude involved (see AGENTS spec point 5). Checks the
// voice rules (no em dash, no "unlock"/"leverage"/"delve") and that the
// address/name degrade gracefully when missing.

import { describe, it, expect } from 'vitest';
import { draftColdSnapCheckinMessage, draftRevealPhotoCrewMessage } from './drafts';

const VOICE_BANNED = [/—/, /\bunlock\b/i, /\bleverage\b/i, /\bdelve\b/i];

function assertVoiceClean(text: string) {
  for (const pattern of VOICE_BANNED) {
    expect(text).not.toMatch(pattern);
  }
}

describe('draftRevealPhotoCrewMessage', () => {
  it('tells the crew to get the reveal shot tonight at the address', () => {
    const msg = draftRevealPhotoCrewMessage({ address: '12 Elm St', customerName: 'Jordan Rivera' });
    expect(msg).toContain('12 Elm St');
    expect(msg.toLowerCase()).toContain('reveal shot');
    assertVoiceClean(msg);
  });

  it('degrades gracefully with no address on file', () => {
    const msg = draftRevealPhotoCrewMessage({ address: null, customerName: 'Jordan Rivera' });
    expect(msg.toLowerCase()).not.toContain('null');
    assertVoiceClean(msg);
  });
});

describe('draftColdSnapCheckinMessage', () => {
  it('is a warm check-in that uses the customer name when known', () => {
    const msg = draftColdSnapCheckinMessage({ customerName: 'Jordan' });
    expect(msg).toContain('Jordan');
    assertVoiceClean(msg);
  });

  it('degrades gracefully with no name on file', () => {
    const msg = draftColdSnapCheckinMessage({ customerName: null });
    expect(msg.toLowerCase()).not.toContain('null');
    assertVoiceClean(msg);
  });

  it('stays under a normal SMS length', () => {
    const msg = draftColdSnapCheckinMessage({ customerName: 'Jordan' });
    expect(msg.length).toBeLessThanOrEqual(320);
  });
});
