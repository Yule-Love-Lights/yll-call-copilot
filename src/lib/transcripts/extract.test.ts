// Coverage for extractLearnings: the happy path, the throws-when-unconfigured
// path, and the normalize/retry recovery — same mocking style as
// src/lib/playbook/generate.test.ts (mocks getClaudeClient via ../claude).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Learnings } from './types';

const createMock = vi.fn();
const getClaudeClientMock = vi.fn();

vi.mock('../claude', () => ({
  getClaudeClient: () => getClaudeClientMock(),
}));

import { extractLearnings, EXTRACT_MODEL, truncateTranscript } from './extract';

const sampleLearnings: Learnings = {
  objections: [
    { objection: 'price too high', customer_words: 'that seems like a lot', rep_response: 'walked through what is included', worked: true },
  ],
  customer_language: ['seems like a lot'],
  what_worked: ['breaking down what is included'],
  what_failed: [],
  price_talk: ['quoted the full roofline package'],
  questions: ['what is included'],
  summary: 'Customer raised a price objection, rep broke down the package, call ended positively.',
};

describe('extractLearnings', () => {
  beforeEach(() => {
    createMock.mockReset();
    getClaudeClientMock.mockReset();
    getClaudeClientMock.mockReturnValue({ messages: { create: createMock } });
  });

  describe('happy path', () => {
    it('parses the emit_learnings tool_use block into Learnings', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_learnings', input: sampleLearnings }],
        stop_reason: 'tool_use',
      });

      const result = await extractLearnings('Rep: hi. Customer: hello.', 'Holiday Lighting');

      expect(result).toEqual(sampleLearnings);
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    it('forces the emit_learnings tool and uses the configured model + token limit', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_learnings', input: sampleLearnings }],
        stop_reason: 'tool_use',
      });

      await extractLearnings('a transcript', 'Event Lighting');

      const call = createMock.mock.calls[0][0];
      expect(call.model).toBe(EXTRACT_MODEL);
      expect(call.model).toBe('claude-haiku-4-5-20251001');
      expect(call.tool_choice).toEqual({ type: 'tool', name: 'emit_learnings' });
      expect(call.max_tokens).toBe(4096);
      expect(call.tools[0].name).toBe('emit_learnings');
    });
  });

  describe('not configured', () => {
    it('throws when Claude is not configured', async () => {
      getClaudeClientMock.mockReturnValue(null);

      await expect(extractLearnings('x', 'Holiday Lighting')).rejects.toThrow(/not configured/i);
      expect(createMock).not.toHaveBeenCalled();
    });
  });

  describe('malformed response', () => {
    it('throws when Claude responds without a tool_use block', async () => {
      createMock.mockResolvedValue({ content: [{ type: 'text', text: 'oops' }], stop_reason: 'end_turn' });

      await expect(extractLearnings('x', 'Holiday Lighting')).rejects.toThrow(/did not return learnings/i);
    });

    it('throws when the response was cut off by the token limit', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_learnings', input: { objections: [] } }],
        stop_reason: 'max_tokens',
      });

      await expect(extractLearnings('x', 'Holiday Lighting')).rejects.toThrow(/token limit/i);
    });

    it('throws after one retry when the tool input never validates', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_learnings', input: { objections: [] } }],
        stop_reason: 'tool_use',
      });

      await expect(extractLearnings('x', 'Holiday Lighting')).rejects.toThrow(/incomplete learnings/i);
      expect(createMock).toHaveBeenCalledTimes(2);
    });

    it('recovers when the retry returns valid learnings', async () => {
      createMock
        .mockResolvedValueOnce({
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_learnings', input: { objections: [] } }],
          stop_reason: 'tool_use',
        })
        .mockResolvedValueOnce({
          content: [{ type: 'tool_use', id: 'toolu_2', name: 'emit_learnings', input: sampleLearnings }],
          stop_reason: 'tool_use',
        });

      const result = await extractLearnings('x', 'Holiday Lighting');

      expect(result).toEqual(sampleLearnings);
      expect(createMock).toHaveBeenCalledTimes(2);

      const secondCallMessages = createMock.mock.calls[1][0].messages;
      const toolResult = secondCallMessages.at(-1).content[0];
      expect(toolResult.type).toBe('tool_result');
      expect(toolResult.is_error).toBe(true);
      expect(toolResult.tool_use_id).toBe('toolu_1');
    });

    it('normalizes an XML-tagged array field instead of failing', async () => {
      createMock.mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'emit_learnings',
            input: {
              ...sampleLearnings,
              what_worked: '<item>Breaking down the package</item><item>Offering the discount</item>',
            },
          },
        ],
        stop_reason: 'tool_use',
      });

      const result = await extractLearnings('x', 'Holiday Lighting');
      expect(result.what_worked).toEqual(['Breaking down the package', 'Offering the discount']);
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    it('recovers a JSON-encoded-string array field', async () => {
      createMock.mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'emit_learnings',
            input: { ...sampleLearnings, questions: '["how long does it take", "do you offer financing"]' },
          },
        ],
        stop_reason: 'tool_use',
      });

      const result = await extractLearnings('x', 'Holiday Lighting');
      expect(result.questions).toEqual(['how long does it take', 'do you offer financing']);
    });
  });
});

describe('truncateTranscript', () => {
  it('leaves a short transcript untouched', () => {
    const text = 'Rep: hi.\nCustomer: hello.';
    expect(truncateTranscript(text)).toBe(text);
  });

  it('keeps the head and tail and marks the cut for a long transcript', () => {
    const text = 'A'.repeat(20000);
    const result = truncateTranscript(text);

    expect(result.length).toBeLessThan(text.length);
    expect(result).toContain('[... transcript truncated for length ...]');
    expect(result.startsWith('A'.repeat(100))).toBe(true);
    expect(result.endsWith('A'.repeat(100))).toBe(true);
  });
});
