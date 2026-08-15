import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolveCurrentHubActor: vi.fn() }));

vi.mock('./resource', () => ({
  resolveCurrentHubActor: mocks.resolveCurrentHubActor,
}));

import { getSessionEmail } from './session';

describe('getSessionEmail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the UUID-linked compatibility email for a phone-only actor', async () => {
    mocks.resolveCurrentHubActor.mockResolvedValue({
      status: 'resolved',
      actor: { email: 'office@yulelovelights.com' },
    });

    await expect(getSessionEmail()).resolves.toBe('office@yulelovelights.com');
  });

  it.each([
    { status: 'denied', reason: 'not_staff' },
    { status: 'unavailable' },
  ])('returns null when actor resolution is not available: %#', async resolution => {
    mocks.resolveCurrentHubActor.mockResolvedValue(resolution);
    await expect(getSessionEmail()).resolves.toBeNull();
  });
});
