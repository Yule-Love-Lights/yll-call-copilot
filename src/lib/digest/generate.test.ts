// Coverage for generateWeeklyDigestNarrative: the happy path (an emit_digest
// tool_use block parsed into a digest, including a null role_play), the
// retry-then-recover and retry-then-throw malformed paths, and the
// not-configured path. Mocks the Anthropic client via ../claude, the same
// seam src/lib/analytics/brainReview.test.ts mocks.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DigestStats } from './stats';

const createMock = vi.fn();
const getClaudeClientMock = vi.fn();

vi.mock('../claude', () => ({
  getClaudeClient: () => getClaudeClientMock(),
}));

import { generateWeeklyDigestNarrative, DIGEST_MODEL } from './generate';

const sampleStats: DigestStats = {
  periodStart: '2026-07-06',
  periodEnd: '2026-07-12',
  team: { calls: 12, reps: 3, avgOverall: 76, avgExperience: 7.5 },
  reps: [{ repEmail: 'a@yll.com', calls: 6, avgOverall: 80, avgExperience: 8, deltaOverall: 5, deltaExperience: 0.5 }],
  lowestDimensions: [
    { key: 'hospitality_dead_air', label: 'Dead air and interruptions', avgRatio: 40, calls: 12 },
    { key: 'sales_objections', label: 'Objection handling', avgRatio: 50, calls: 12 },
    { key: 'emotional_match', label: 'Emotional diagnosis and match', avgRatio: 55, calls: 12 },
  ],
  guarantees: [{ key: 'fast_fix_48h', label: '48-hour fast-fix guarantee', done: 8, applicable: 10, rate: 80 }],
  bestCall: { id: 'call-1', repEmail: 'a@yll.com', overall: 95, win: 'Closed on the first call.' },
  roughestMoment: {
    id: 'call-2',
    repEmail: 'b@yll.com',
    overall: 45,
    fix: { moment: 'Price stated cold', timestampSeconds: 90, transcriptQuote: '...', betterLine: 'Value first, then the number.' },
  },
};

const sampleDigest = {
  narrative: 'Team average held at 76 this week. Dead air is the biggest miss across the team.',
  training_focus: 'Cut dead air by pausing less between questions and the next line.',
  role_play: {
    setup: 'A guarded homeowner getting a second opinion after a bad experience with another company.',
    what_the_customer_says: "That's more than I expected, let me think about it.",
    what_good_looks_like: 'Stack the value (design, install, service, takedown, storage all included) before repeating the number, run the proof-and-guarantees track.',
  },
};

function baseInput() {
  return { stats: sampleStats, proposals: [] };
}

describe('generateWeeklyDigestNarrative', () => {
  beforeEach(() => {
    createMock.mockReset();
    getClaudeClientMock.mockReset();
    getClaudeClientMock.mockReturnValue({ messages: { create: createMock } });
  });

  describe('happy path', () => {
    it('parses the emit_digest tool_use block into a digest', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_digest', input: sampleDigest }],
        stop_reason: 'tool_use',
      });

      const result = await generateWeeklyDigestNarrative(baseInput());
      expect(result).toEqual({
        narrative: sampleDigest.narrative,
        trainingFocus: sampleDigest.training_focus,
        rolePlay: {
          setup: sampleDigest.role_play.setup,
          whatTheCustomerSays: sampleDigest.role_play.what_the_customer_says,
          whatGoodLooksLike: sampleDigest.role_play.what_good_looks_like,
        },
      });
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    it('forces the emit_digest tool and uses the configured model', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_digest', input: sampleDigest }],
        stop_reason: 'tool_use',
      });

      await generateWeeklyDigestNarrative(baseInput());

      const call = createMock.mock.calls[0][0];
      expect(call.model).toBe(DIGEST_MODEL);
      expect(call.model).toBe('claude-opus-4-8');
      expect(call.tool_choice).toEqual({ type: 'tool', name: 'emit_digest' });
      expect(call.tools[0].name).toBe('emit_digest');
    });

    it('accepts a null role_play for a week with no roughest moment', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_digest', input: { ...sampleDigest, role_play: null } }],
        stop_reason: 'tool_use',
      });

      const result = await generateWeeklyDigestNarrative(baseInput());
      expect(result.rolePlay).toBeNull();
    });

    it('includes the proposals in the prompt when there are any', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_digest', input: sampleDigest }],
        stop_reason: 'tool_use',
      });

      await generateWeeklyDigestNarrative({
        stats: sampleStats,
        proposals: [
          {
            id: 'p1',
            verticalId: 'v1',
            verticalName: 'Holiday Lighting',
            section: 'avoid',
            kind: 'add',
            currentValue: null,
            proposedValue: 'Do not mention financing before the customer asks.',
            evidence: 'appeared in 4 of 10 calls this period',
            createdAt: '2026-07-10T00:00:00.000Z',
          },
        ],
      });

      const promptText = createMock.mock.calls[0][0].messages[0].content;
      expect(promptText).toContain('Holiday Lighting');
      expect(promptText).toContain('financing');
    });
  });

  describe('not configured', () => {
    it('throws when Claude is not configured', async () => {
      getClaudeClientMock.mockReturnValue(null);

      await expect(generateWeeklyDigestNarrative(baseInput())).rejects.toThrow(/not configured/i);
      expect(createMock).not.toHaveBeenCalled();
    });
  });

  describe('malformed response', () => {
    it('throws when Claude responds without a tool_use block', async () => {
      createMock.mockResolvedValue({ content: [{ type: 'text', text: 'oops' }], stop_reason: 'end_turn' });

      await expect(generateWeeklyDigestNarrative(baseInput())).rejects.toThrow(/did not return a digest/i);
    });

    it('throws when the response was cut off by the token limit', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_digest', input: sampleDigest }],
        stop_reason: 'max_tokens',
      });

      await expect(generateWeeklyDigestNarrative(baseInput())).rejects.toThrow(/token limit/i);
    });

    it('throws when narrative is missing, after one retry', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_digest', input: { training_focus: 'x', role_play: null } }],
        stop_reason: 'tool_use',
      });

      await expect(generateWeeklyDigestNarrative(baseInput())).rejects.toThrow(/invalid digest/i);
      expect(createMock).toHaveBeenCalledTimes(2);
    });

    it('rejects a malformed role_play (missing a required field)', async () => {
      createMock.mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'emit_digest',
            input: { ...sampleDigest, role_play: { setup: 'x', what_the_customer_says: 'y' } },
          },
        ],
        stop_reason: 'tool_use',
      });

      await expect(generateWeeklyDigestNarrative(baseInput())).rejects.toThrow(/invalid digest/i);
    });

    it('recovers when the retry returns a valid digest', async () => {
      createMock
        .mockResolvedValueOnce({
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_digest', input: { narrative: '', training_focus: '', role_play: null } }],
          stop_reason: 'tool_use',
        })
        .mockResolvedValueOnce({
          content: [{ type: 'tool_use', id: 'toolu_2', name: 'emit_digest', input: sampleDigest }],
          stop_reason: 'tool_use',
        });

      const result = await generateWeeklyDigestNarrative(baseInput());
      expect(result.narrative).toBe(sampleDigest.narrative);
      expect(createMock).toHaveBeenCalledTimes(2);

      const secondCallMessages = createMock.mock.calls[1][0].messages;
      const toolResult = secondCallMessages.at(-1).content[0];
      expect(toolResult.type).toBe('tool_result');
      expect(toolResult.is_error).toBe(true);
      expect(toolResult.tool_use_id).toBe('toolu_1');
    });
  });
});
