// Coverage for generateCoachCard -- the segment-to-event path once a trigger
// has fired: the happy path (a tool_use block parsed into a CoachCard), the
// not-configured path, and the normalize+retry path (a wrapped-string field
// recovered via the shared unwrapObjectStringArray helper). Same mocking
// style as src/lib/playbook/generate.test.ts and
// src/lib/leads/followups.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Trigger } from './engine';

const createMock = vi.fn();
const getClaudeClientMock = vi.fn();

vi.mock('../claude', () => ({
  getClaudeClient: () => getClaudeClientMock(),
}));

import { generateCoachCard, normalizeCardInput, COACH_MODEL } from './card';

const sampleTrigger: Trigger = { type: 'price', atMs: 42_000, matchedText: 'how much' };
const sampleCard = { card: 'Walk her through what is included first', expanded: 'Price objections land softer once the value is clear. Cover install, teardown, and storage before quoting a number.' };

describe('generateCoachCard', () => {
  beforeEach(() => {
    createMock.mockReset();
    getClaudeClientMock.mockReset();
    getClaudeClientMock.mockReturnValue({ messages: { create: createMock } });
  });

  describe('happy path', () => {
    it('parses the emit_card tool_use block into a CoachCard', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_card', input: sampleCard }],
        stop_reason: 'tool_use',
      });

      const result = await generateCoachCard({ trigger: sampleTrigger, rollingTranscript: 'customer: how much?', playbook: null });

      expect(result).toEqual(sampleCard);
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    it('forces the emit_card tool and uses the configured model', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_card', input: sampleCard }],
        stop_reason: 'tool_use',
      });

      await generateCoachCard({ trigger: sampleTrigger, rollingTranscript: '', playbook: null });

      const call = createMock.mock.calls[0][0];
      expect(call.model).toBe(COACH_MODEL);
      expect(call.model).toBe('claude-haiku-4-5-20251001');
      expect(call.tool_choice).toEqual({ type: 'tool', name: 'emit_card' });
      expect(call.tools[0].name).toBe('emit_card');
    });
  });

  describe('not configured', () => {
    it('throws when Claude is not configured', async () => {
      getClaudeClientMock.mockReturnValue(null);

      await expect(
        generateCoachCard({ trigger: sampleTrigger, rollingTranscript: '', playbook: null }),
      ).rejects.toThrow(/not configured/i);
      expect(createMock).not.toHaveBeenCalled();
    });
  });

  describe('malformed response', () => {
    it('throws when Claude responds without a tool_use block', async () => {
      createMock.mockResolvedValue({ content: [{ type: 'text', text: 'oops' }], stop_reason: 'end_turn' });

      await expect(
        generateCoachCard({ trigger: sampleTrigger, rollingTranscript: '', playbook: null }),
      ).rejects.toThrow(/did not return a coaching card/i);
    });

    it('throws when the response was cut off by the token limit', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_card', input: { card: 'x' } }],
        stop_reason: 'max_tokens',
      });

      await expect(
        generateCoachCard({ trigger: sampleTrigger, rollingTranscript: '', playbook: null }),
      ).rejects.toThrow(/token limit/i);
    });

    it('throws after the retry is also invalid', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_card', input: { card: '', expanded: '' } }],
        stop_reason: 'tool_use',
      });

      await expect(
        generateCoachCard({ trigger: sampleTrigger, rollingTranscript: '', playbook: null }),
      ).rejects.toThrow(/invalid coaching card/i);
      expect(createMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('retry path', () => {
    it('recovers when the retry returns a valid card', async () => {
      createMock
        .mockResolvedValueOnce({
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_card', input: { card: '', expanded: 'x' } }],
          stop_reason: 'tool_use',
        })
        .mockResolvedValueOnce({
          content: [{ type: 'tool_use', id: 'toolu_2', name: 'emit_card', input: sampleCard }],
          stop_reason: 'tool_use',
        });

      const result = await generateCoachCard({ trigger: sampleTrigger, rollingTranscript: '', playbook: null });
      expect(result).toEqual(sampleCard);
      expect(createMock).toHaveBeenCalledTimes(2);

      // The retry must carry the failed tool call back as an is_error tool_result.
      const secondCallMessages = createMock.mock.calls[1][0].messages;
      const toolResult = secondCallMessages.at(-1).content[0];
      expect(toolResult.type).toBe('tool_result');
      expect(toolResult.is_error).toBe(true);
      expect(toolResult.tool_use_id).toBe('toolu_1');
    });

    it('normalizes a wrapped-object card field instead of failing (reuses unwrapObjectStringArray)', async () => {
      createMock.mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'emit_card',
            input: { card: { text: sampleCard.card }, expanded: { value: sampleCard.expanded } },
          },
        ],
        stop_reason: 'tool_use',
      });

      const result = await generateCoachCard({ trigger: sampleTrigger, rollingTranscript: '', playbook: null });
      expect(result).toEqual(sampleCard);
      expect(createMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe('normalizeCardInput', () => {
  it('unwraps a single-key wrapped-object string field', () => {
    const out = normalizeCardInput({ card: { text: 'Ask about their timeline now' }, expanded: 'already a string' }) as Record<
      string,
      unknown
    >;
    expect(out.card).toBe('Ask about their timeline now');
    expect(out.expanded).toBe('already a string');
  });

  it('leaves a field alone when it cannot unwrap to a string', () => {
    const ambiguous = { one: 'a', two: 'b' };
    const out = normalizeCardInput({ card: ambiguous, expanded: 'x' }) as Record<string, unknown>;
    expect(out.card).toEqual(ambiguous);
  });

  it('passes through a non-object input unchanged', () => {
    expect(normalizeCardInput('not an object')).toBe('not an object');
  });
});
