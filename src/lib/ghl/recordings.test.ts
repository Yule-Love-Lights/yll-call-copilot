// Coverage for the pure message-classification helpers in recordings.ts.
// The network-calling functions (listRecentCallRecordings,
// downloadRecordingAudio, getGhlUserEmail) are NOT unit tested here — their
// field mapping is explicitly unverified against a live GHL payload (see
// the module comment) and needs a live probe before the nightly cron goes
// live, not a mock that just encodes the same guess back at itself.

import { describe, it, expect } from 'vitest';
import { isCompletedCallMessage, messageDuration } from './recordings';

describe('isCompletedCallMessage', () => {
  it('is true for a completed call message (messageType shape)', () => {
    expect(isCompletedCallMessage({ id: 'm1', messageType: 'TYPE_CALL', meta: { call: { status: 'completed' } } })).toBe(
      true,
    );
  });

  it('is true for a completed call message (flat callStatus shape)', () => {
    expect(isCompletedCallMessage({ id: 'm1', type: 'call', callStatus: 'completed' })).toBe(true);
  });

  it('is false for a non-call message type', () => {
    expect(isCompletedCallMessage({ id: 'm1', messageType: 'TYPE_SMS', meta: { call: { status: 'completed' } } })).toBe(
      false,
    );
  });

  it('is false for a call message that is not completed (voicemail/no-answer/missing status)', () => {
    expect(isCompletedCallMessage({ id: 'm1', messageType: 'TYPE_CALL', meta: { call: { status: 'voicemail' } } })).toBe(
      false,
    );
    expect(isCompletedCallMessage({ id: 'm1', messageType: 'TYPE_CALL' })).toBe(false);
  });
});

describe('messageDuration', () => {
  it('reads duration from the nested meta.call shape', () => {
    expect(messageDuration({ id: 'm1', meta: { call: { duration: 90 } } })).toBe(90);
  });

  it('reads duration from the flat callDuration shape', () => {
    expect(messageDuration({ id: 'm1', callDuration: 45 })).toBe(45);
  });

  it('is null when no duration field is present', () => {
    expect(messageDuration({ id: 'm1' })).toBeNull();
  });
});
