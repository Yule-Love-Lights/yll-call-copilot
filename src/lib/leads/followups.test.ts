// Coverage for generateFollowups: happy path, not-configured, and the
// validation-retry path (an oversized SMS on the first attempt, corrected on
// the second) — same mocking style as src/lib/playbook/generate.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const createMock = vi.fn();
const getClaudeClientMock = vi.fn();

vi.mock('../claude', () => ({
  getClaudeClient: () => getClaudeClientMock(),
}));

import { generateFollowups, FOLLOWUP_MODEL } from './followups';

const sampleFollowups = {
  email: { subject: 'Great talking with you today', body: 'Thanks for the call. We will follow up with a firm date soon.' },
  sms: 'Hi, this is Yule Love Lights following up on our call. Let us know if you have questions.',
};

describe('generateFollowups', () => {
  beforeEach(() => {
    createMock.mockReset();
    getClaudeClientMock.mockReset();
    getClaudeClientMock.mockReturnValue({ messages: { create: createMock } });
  });

  describe('happy path', () => {
    it('parses the emit_followups tool_use block', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_followups', input: sampleFollowups }],
        stop_reason: 'tool_use',
      });

      const result = await generateFollowups({
        contactName: 'Jordan Rivera',
        verticalName: 'Holiday Lighting',
        outcome: 'interested',
        notes: 'Wants a quote for the whole roofline.',
        playbook: null,
      });

      expect(result).toEqual(sampleFollowups);
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    it('forces the emit_followups tool and uses the configured model', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_followups', input: sampleFollowups }],
        stop_reason: 'tool_use',
      });

      await generateFollowups({
        contactName: null,
        verticalName: null,
        outcome: 'callback',
        notes: '',
        playbook: null,
      });

      const call = createMock.mock.calls[0][0];
      expect(call.model).toBe(FOLLOWUP_MODEL);
      expect(call.model).toBe('claude-haiku-4-5-20251001');
      expect(call.tool_choice).toEqual({ type: 'tool', name: 'emit_followups' });
      expect(call.tools[0].name).toBe('emit_followups');
    });
  });

  describe('not configured', () => {
    it('throws when Claude is not configured', async () => {
      getClaudeClientMock.mockReturnValue(null);

      await expect(
        generateFollowups({ contactName: null, verticalName: null, outcome: 'voicemail', notes: '', playbook: null }),
      ).rejects.toThrow(/not configured/i);
      expect(createMock).not.toHaveBeenCalled();
    });
  });

  describe('malformed response', () => {
    it('throws when Claude responds without a tool_use block', async () => {
      createMock.mockResolvedValue({ content: [{ type: 'text', text: 'oops' }], stop_reason: 'end_turn' });

      await expect(
        generateFollowups({ contactName: null, verticalName: null, outcome: 'interested', notes: '', playbook: null }),
      ).rejects.toThrow(/did not return follow-up drafts/i);
    });

    it('throws when the response was cut off by the token limit', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_followups', input: { email: { subject: 'x' } } }],
        stop_reason: 'max_tokens',
      });

      await expect(
        generateFollowups({ contactName: null, verticalName: null, outcome: 'interested', notes: '', playbook: null }),
      ).rejects.toThrow(/token limit/i);
    });

    it('rejects an SMS over 320 characters and retries', async () => {
      createMock
        .mockResolvedValueOnce({
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'emit_followups',
              input: { ...sampleFollowups, sms: 'x'.repeat(321) },
            },
          ],
          stop_reason: 'tool_use',
        })
        .mockResolvedValueOnce({
          content: [{ type: 'tool_use', id: 'toolu_2', name: 'emit_followups', input: sampleFollowups }],
          stop_reason: 'tool_use',
        });

      const result = await generateFollowups({
        contactName: 'Jordan',
        verticalName: 'Holiday Lighting',
        outcome: 'interested',
        notes: 'x',
        playbook: null,
      });

      expect(result).toEqual(sampleFollowups);
      expect(createMock).toHaveBeenCalledTimes(2);

      const secondCallMessages = createMock.mock.calls[1][0].messages;
      const toolResult = secondCallMessages.at(-1).content[0];
      expect(toolResult.type).toBe('tool_result');
      expect(toolResult.is_error).toBe(true);
      expect(toolResult.tool_use_id).toBe('toolu_1');
    });

    it('throws after the retry is also invalid', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_followups', input: { email: {}, sms: '' } }],
        stop_reason: 'tool_use',
      });

      await expect(
        generateFollowups({ contactName: null, verticalName: null, outcome: 'interested', notes: '', playbook: null }),
      ).rejects.toThrow(/invalid follow-up drafts/i);
      expect(createMock).toHaveBeenCalledTimes(2);
    });

    it('normalizes a JSON-encoded-string email field instead of failing', async () => {
      createMock.mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'emit_followups',
            input: { email: JSON.stringify(sampleFollowups.email), sms: sampleFollowups.sms },
          },
        ],
        stop_reason: 'tool_use',
      });

      const result = await generateFollowups({
        contactName: null,
        verticalName: null,
        outcome: 'interested',
        notes: '',
        playbook: null,
      });
      expect(result.email).toEqual(sampleFollowups.email);
      expect(createMock).toHaveBeenCalledTimes(1);
    });
  });
});
