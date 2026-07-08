// The weekly "compounding brain" review: one Claude call that reads a
// vertical's recent stats (src/lib/analytics/stats.ts), its all-time
// learnings aggregate (src/lib/transcripts/insights.ts, the same aggregate
// the distill route reads), its current playbook, and its most-repeated
// noise-rated coaching cards, then produces a short owner-facing narrative
// plus up to 5 playbook proposals in the SAME shape Wave B's
// distillProposals produces (src/lib/transcripts/distill.ts) — reuses that
// shape's validation verbatim rather than building a second proposals
// system. Same forced tool-use + normalize/validate/single-retry pattern as
// generate.ts/distill.ts.

import Anthropic from '@anthropic-ai/sdk';
import { getClaudeClient } from '../claude';
import { unwrapObjectStringArray } from '../playbook/normalize';
import { SECTIONS, KINDS, validateProposals, type DistilledProposal, type InsightsAggregate } from '../transcripts/distill';
import type { Playbook } from '../playbook/types';
import type { StatsResult } from './stats';

// Single exported const for the model id — bump here, nowhere else, if the
// model ever changes. Opus, not Sonnet: this runs once a week per vertical
// (not per call or per click) and synthesizes across a whole period's stats
// plus all-time learnings into proposals that edit a live playbook, so
// judgment quality matters more than per-call cost here.
export const BRAIN_MODEL = 'claude-opus-4-8';

const SYSTEM_PROMPT = `You are a sales operations analyst for Yule Love Lights, a residential and commercial lighting company (holiday lighting, permanent exterior lighting, event lighting, and commercial lighting). You write a short weekly review for the business owner, who is not a salesperson, on one line of business, plus you propose concrete playbook edits the data actually supports.

The narrative is for the owner: short sentences, plain words, no jargon. Cite real counts and percentages from the stats and learnings you are given (for example "18 of 40 calls connected this week" or "interested rate held at 22%"). Say plainly what is winning and what is dying. Do not invent a number that is not in the data you were given.

Never use an em dash. Never use the words "unlock", "leverage", or "delve".

Propose at most 5 playbook edits, each backed by the stats or learnings you were given, in the same shape as a playbook-edit proposal: add (a new item), change (an edit to an existing item — set current_value to the existing item), or remove (drop an existing item — set current_value to it and proposed_value to null). Every proposal needs an evidence string citing real counts, for example "appeared in 6 of 14 calls this period". Do not propose a change the data does not support.

You may also be given coaching cards reps rated "noise" repeatedly this period. If one looks genuinely unhelpful rather than just situational, propose a fix as one of your (at most 5) proposals: either an "avoid" section addition telling the rep to disregard that kind of prompt, or a note describing how the trigger should be tuned. Skip it if the data does not clearly support a change — do not force a proposal just because a card was rated noise once or twice.

In the emit_review tool call, narrative must be real JSON of type string and proposals must be a real JSON array, one object per item, never a single string and never items wrapped in XML tags like <proposal>. proposed_value must be real JSON of the shape the section expects (icp/voicemail/angles/avoid: a string; openers: an object with label and script; objections: an object with objection and response).`;

const EMIT_REVIEW_TOOL: Anthropic.Tool = {
  name: 'emit_review',
  description: 'Return the weekly brain review for one vertical: a short narrative for the owner plus up to 5 proposed playbook edits.',
  input_schema: {
    type: 'object',
    properties: {
      narrative: {
        type: 'string',
        description:
          'Short plain-English summary for the business owner: what is winning, what is dying. Short sentences, cite real counts, no em dashes, never "unlock"/"leverage"/"delve".',
      },
      proposals: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            section: {
              type: 'string',
              enum: SECTIONS,
              description: 'Which playbook section this edit targets.',
            },
            kind: {
              type: 'string',
              enum: KINDS,
              description: 'add a new item, change an existing one, or remove one.',
            },
            current_value: {
              description: 'The existing value being changed or removed. Omit (or null) for kind "add".',
            },
            proposed_value: {
              description: 'The new value for "add"/"change". For "remove" this may be null.',
            },
            evidence: {
              type: 'string',
              description: 'Why this change is proposed, citing real counts, e.g. "appeared in 6 of 14 calls this period".',
            },
          },
          required: ['section', 'kind', 'evidence'],
        },
        description:
          'Up to 5 proposed playbook edits, including any avoid-list or trigger-tuning note warranted by repeatedly noise-rated coaching cards.',
      },
    },
    required: ['narrative', 'proposals'],
  },
};

export type BrainReviewInput = {
  verticalName: string;
  periodStart: string;
  periodEnd: string;
  stats: StatsResult;
  insights: InsightsAggregate;
  playbook: Playbook | null;
  topNoiseCards: { text: string; count: number }[];
};

export type BrainReviewResult = { narrative: string; proposals: DistilledProposal[] };

// Defense-in-depth, same as normalizePlaybookInput (src/lib/playbook/
// normalize.ts): recover a proposals array Claude wrapped as single-key
// objects instead of the declared shape. A harmless no-op when proposals
// already arrived as well-formed multi-key objects, which is the common case
// — this is the same shared helper generate.ts leans on, applied here too.
function normalizeReviewInput(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return input;
  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  if (Array.isArray(out.proposals)) {
    out.proposals = unwrapObjectStringArray(out.proposals);
  }
  return out;
}

type ReviewValidationResult = { valid: true; review: BrainReviewResult } | { valid: false; error: string };

// Validates narrative itself, then reuses distill.ts's validateProposals
// verbatim for the proposals array (it reads value.proposals and ignores
// sibling keys, so the same {narrative, proposals} object works unchanged).
function validateReview(value: unknown): ReviewValidationResult {
  if (typeof value !== 'object' || value === null) {
    return { valid: false, error: 'Result must be an object.' };
  }
  const v = value as Record<string, unknown>;
  if (typeof v.narrative !== 'string' || !v.narrative.trim()) {
    return { valid: false, error: 'narrative must be a non-empty string.' };
  }
  const proposalsCheck = validateProposals(value);
  if (!proposalsCheck.valid) return { valid: false, error: proposalsCheck.error };

  return {
    valid: true,
    // validateProposals caps at 10 (Wave B's own ceiling) — cap again at 5
    // here regardless of what Claude returned, since the brief for this
    // review is "up to 5", not 10.
    review: { narrative: v.narrative.trim(), proposals: proposalsCheck.proposals.slice(0, 5) },
  };
}

const MAX_ATTEMPTS = 2;
// A narrative plus up to 5 proposals mirroring whole playbook sections —
// same generous ceiling as generate.ts/distill.ts.
const MAX_TOKENS = 8000;

export async function generateBrainReview(input: BrainReviewInput): Promise<BrainReviewResult> {
  const client = getClaudeClient();
  if (!client) {
    throw new Error('Claude not configured. Set ANTHROPIC_API_KEY in .env.local');
  }

  const noiseSection =
    input.topNoiseCards.length > 0
      ? [
          'Coaching cards reps rated "noise" most often this period (card text, times rated noise):',
          ...input.topNoiseCards.map(c => `- "${c.text}" (${c.count}x)`),
        ].join('\n')
      : 'No coaching cards were rated "noise" this period.';

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        `Vertical: ${input.verticalName}`,
        `Review period: ${input.periodStart} to ${input.periodEnd}`,
        '',
        'Stats for this period:',
        JSON.stringify(input.stats, null, 2),
        '',
        'All-time learnings aggregate for this vertical:',
        JSON.stringify(input.insights, null, 2),
        '',
        'Current active playbook:',
        input.playbook ? JSON.stringify(input.playbook, null, 2) : '(no active playbook yet)',
        '',
        noiseSection,
        '',
        'Write the weekly brain review now.',
      ].join('\n'),
    },
  ];

  let lastError = 'unknown validation error';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await client.messages.create({
      model: BRAIN_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [EMIT_REVIEW_TOOL],
      tool_choice: { type: 'tool', name: 'emit_review' },
      messages,
    });

    if (response.stop_reason === 'max_tokens') {
      throw new Error('Brain review generation ran past the token limit; nothing was saved.');
    }

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === 'emit_review',
    );
    if (!toolUse) {
      throw new Error('Claude did not return a review.');
    }

    const checked = validateReview(normalizeReviewInput(toolUse.input));
    if (checked.valid) {
      return checked.review;
    }
    lastError = checked.error;

    if (attempt < MAX_ATTEMPTS) {
      const allToolUses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      messages.push(
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content: allToolUses.map(block => ({
            type: 'tool_result' as const,
            tool_use_id: block.id,
            is_error: true,
            content: `That result was rejected: ${checked.error} Call emit_review again with narrative as a real string and proposals as a valid array.`,
          })),
        },
      );
    }
  }

  throw new Error(`Claude returned an invalid review (${lastError}); nothing was saved.`);
}
