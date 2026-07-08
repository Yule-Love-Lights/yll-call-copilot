// Coverage for generateBrainReview: the happy path (an emit_review tool_use
// block parsed into a review), the retry-then-recover and
// retry-then-throw malformed paths, and the not-configured path. Mocks the
// Anthropic client via ../claude, the same seam generate.test.ts and
// followups.test.ts mock.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { StatsResult } from './stats';
import type { InsightsAggregate } from '../transcripts/distill';

const createMock = vi.fn();
const getClaudeClientMock = vi.fn();

vi.mock('../claude', () => ({
  getClaudeClient: () => getClaudeClientMock(),
}));

import { generateBrainReview, BRAIN_MODEL } from './brainReview';

const sampleStats: StatsResult = {
  from: '2026-07-01',
  to: '2026-07-08',
  totalCalls: 10,
  callsByOutcome: { interested: 3, callback: 1, not_interested: 2, wrong_number: 0, voicemail: 3, no_answer: 1 },
  noOutcomeCalls: 0,
  connectRate: 60,
  interestedCount: 3,
  interestedRate: 30,
  byOpener: [],
  byVersion: [],
  followupsSent: 2,
  coaching: { helpful: 4, noise: 1, helpfulRate: 80 },
  transcripts: { booked: 2, notBooked: 1, unknown: 0, total: 3 },
  trend: [],
};

const sampleInsights: InsightsAggregate = {
  totalCalls: 20,
  booked: 8,
  notBooked: 6,
  unknownOutcome: 6,
  topObjections: [],
  topQuestions: [],
  topWhatWorked: [],
  topWhatFailed: [],
  samplePriceTalk: [],
};

const sampleReview = {
  narrative: 'Interested rate held at 30% this week. Voicemail is the biggest miss at 3 of 10 calls.',
  proposals: [
    {
      section: 'avoid',
      kind: 'add',
      current_value: null,
      proposed_value: 'Do not mention financing before the customer asks.',
      evidence: 'appeared in 4 of 10 calls this period',
    },
  ],
};

function baseInput() {
  return {
    verticalName: 'Holiday Lighting',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-08',
    stats: sampleStats,
    insights: sampleInsights,
    playbook: null,
    topNoiseCards: [],
  };
}

describe('generateBrainReview', () => {
  beforeEach(() => {
    createMock.mockReset();
    getClaudeClientMock.mockReset();
    getClaudeClientMock.mockReturnValue({ messages: { create: createMock } });
  });

  describe('happy path', () => {
    it('parses the emit_review tool_use block into a review', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_review', input: sampleReview }],
        stop_reason: 'tool_use',
      });

      const result = await generateBrainReview(baseInput());
      expect(result).toEqual(sampleReview);
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    it('forces the emit_review tool and uses the configured model', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_review', input: sampleReview }],
        stop_reason: 'tool_use',
      });

      await generateBrainReview(baseInput());

      const call = createMock.mock.calls[0][0];
      expect(call.model).toBe(BRAIN_MODEL);
      expect(call.model).toBe('claude-opus-4-8');
      expect(call.tool_choice).toEqual({ type: 'tool', name: 'emit_review' });
      expect(call.tools[0].name).toBe('emit_review');
    });

    it('caps proposals at 5 even when more come back', async () => {
      const many = Array.from({ length: 7 }, (_, i) => ({ ...sampleReview.proposals[0], evidence: `evidence ${i}` }));
      createMock.mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'emit_review',
            input: { narrative: sampleReview.narrative, proposals: many },
          },
        ],
        stop_reason: 'tool_use',
      });

      const result = await generateBrainReview(baseInput());
      expect(result.proposals).toHaveLength(5);
    });

    it('includes the noise-card summary in the prompt when there are any', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_review', input: sampleReview }],
        stop_reason: 'tool_use',
      });

      await generateBrainReview({ ...baseInput(), topNoiseCards: [{ text: 'Mention warranty', count: 4 }] });

      const promptText = createMock.mock.calls[0][0].messages[0].content;
      expect(promptText).toContain('Mention warranty');
      expect(promptText).toContain('4x');
    });
  });

  describe('not configured', () => {
    it('throws when Claude is not configured', async () => {
      getClaudeClientMock.mockReturnValue(null);

      await expect(generateBrainReview(baseInput())).rejects.toThrow(/not configured/i);
      expect(createMock).not.toHaveBeenCalled();
    });
  });

  describe('malformed response', () => {
    it('throws when Claude responds without a tool_use block', async () => {
      createMock.mockResolvedValue({ content: [{ type: 'text', text: 'oops' }], stop_reason: 'end_turn' });

      await expect(generateBrainReview(baseInput())).rejects.toThrow(/did not return a review/i);
    });

    it('throws when the response was cut off by the token limit', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_review', input: { narrative: 'x', proposals: [] } }],
        stop_reason: 'max_tokens',
      });

      await expect(generateBrainReview(baseInput())).rejects.toThrow(/token limit/i);
    });

    it('throws when narrative is missing, after one retry', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_review', input: { proposals: [] } }],
        stop_reason: 'tool_use',
      });

      await expect(generateBrainReview(baseInput())).rejects.toThrow(/invalid review/i);
      expect(createMock).toHaveBeenCalledTimes(2);
    });

    it('recovers when the retry returns a valid review', async () => {
      createMock
        .mockResolvedValueOnce({
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_review', input: { narrative: '', proposals: [] } }],
          stop_reason: 'tool_use',
        })
        .mockResolvedValueOnce({
          content: [{ type: 'tool_use', id: 'toolu_2', name: 'emit_review', input: sampleReview }],
          stop_reason: 'tool_use',
        });

      const result = await generateBrainReview(baseInput());
      expect(result).toEqual(sampleReview);
      expect(createMock).toHaveBeenCalledTimes(2);

      // The retry must carry the failed tool call back as an is_error tool_result.
      const secondCallMessages = createMock.mock.calls[1][0].messages;
      const toolResult = secondCallMessages.at(-1).content[0];
      expect(toolResult.type).toBe('tool_result');
      expect(toolResult.is_error).toBe(true);
      expect(toolResult.tool_use_id).toBe('toolu_1');
    });
  });
});
