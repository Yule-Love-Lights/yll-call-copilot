// Coverage for generatePlaybook: the happy path (a tool_use block parsed into
// a Playbook) and the throws-when-unconfigured path. Mocks the Anthropic
// client via ../claude, the same seam getClaudeClient() exposes everywhere
// else in the app (health check, future callers).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Playbook } from './types';

const createMock = vi.fn();
const getClaudeClientMock = vi.fn();

vi.mock('../claude', () => ({
  getClaudeClient: () => getClaudeClientMock(),
}));

import { generatePlaybook, PLAYBOOK_MODEL } from './generate';

const samplePlaybook: Playbook = {
  icp: 'Homeowners in the past-customer list with existing holiday lighting.',
  angles: ['Past customer renewal', 'Neighbor referral'],
  openers: [
    { label: 'Past customer', script: 'Hi, this is Yule Love Lights. We did your lights last year.' },
    { label: 'Neighbor install', script: 'Hi, we just finished an install down your street.' },
    { label: 'Cold', script: 'Hi, this is Yule Love Lights, a local lighting company.' },
  ],
  objections: [
    { objection: 'price', response: 'I hear you. Let me walk through what is included.' },
    { objection: 'not interested', response: 'No problem, thanks for your time.' },
    { objection: 'email me info', response: 'Happy to. Can I grab your email?' },
    { objection: 'spouse decision', response: 'Totally fine, when is a good time to call back?' },
    { objection: 'bad timing', response: 'No worries, when is better?' },
  ],
  avoid: ['Never pressure a homeowner into deciding on the spot.'],
  voicemail: 'Hi, this is Yule Love Lights, give us a call back, thanks.',
};

describe('generatePlaybook', () => {
  beforeEach(() => {
    createMock.mockReset();
    getClaudeClientMock.mockReset();
    getClaudeClientMock.mockReturnValue({ messages: { create: createMock } });
  });

  describe('happy path', () => {
    it('parses the emit_playbook tool_use block into a Playbook', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_playbook', input: samplePlaybook }],
        stop_reason: 'tool_use',
      });

      const result = await generatePlaybook({
        name: 'Holiday Lighting',
        description: 'Residential holiday light installs.',
        knowledgeNotes: '',
      });

      expect(result).toEqual(samplePlaybook);
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    it('forces the emit_playbook tool and uses the configured model + token limit', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_playbook', input: samplePlaybook }],
        stop_reason: 'tool_use',
      });

      await generatePlaybook({ name: 'Holiday Lighting', description: 'x', knowledgeNotes: 'y' });

      const call = createMock.mock.calls[0][0];
      expect(call.model).toBe(PLAYBOOK_MODEL);
      expect(call.model).toBe('claude-sonnet-5');
      expect(call.tool_choice).toEqual({ type: 'tool', name: 'emit_playbook' });
      expect(call.max_tokens).toBe(4000);
      expect(call.tools[0].name).toBe('emit_playbook');
    });

    it('ignores a leading thinking block and still finds the tool_use block', async () => {
      createMock.mockResolvedValue({
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'tool_use', id: 'toolu_1', name: 'emit_playbook', input: samplePlaybook },
        ],
        stop_reason: 'tool_use',
      });

      const result = await generatePlaybook({ name: 'Event', description: 'x', knowledgeNotes: '' });
      expect(result).toEqual(samplePlaybook);
    });
  });

  describe('not configured', () => {
    it('throws when Claude is not configured', async () => {
      getClaudeClientMock.mockReturnValue(null);

      await expect(
        generatePlaybook({ name: 'Holiday Lighting', description: 'x', knowledgeNotes: '' }),
      ).rejects.toThrow(/not configured/i);
      expect(createMock).not.toHaveBeenCalled();
    });
  });

  describe('malformed response', () => {
    it('throws when Claude responds without a tool_use block', async () => {
      createMock.mockResolvedValue({ content: [{ type: 'text', text: 'oops' }], stop_reason: 'end_turn' });

      await expect(
        generatePlaybook({ name: 'Holiday Lighting', description: 'x', knowledgeNotes: '' }),
      ).rejects.toThrow(/did not return a playbook/i);
    });
  });
});
