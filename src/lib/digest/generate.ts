// One Claude call a week: reads the digest stats (src/lib/digest/stats.ts)
// plus this week's playbook proposals, and writes the team-trends narrative,
// the training focus (derived from the three lowest dimensions), and a
// role-play scenario built from the roughest real moment. Same forced
// tool-use + normalize/validate/single-retry pattern as
// src/lib/analytics/brainReview.ts and src/lib/transcripts/distill.ts.

import Anthropic from '@anthropic-ai/sdk';
import { getClaudeClient } from '../claude';
import type { DigestStats } from './stats';
import type { ProposalForDigest } from './loadCallScores';

// Single exported const for the model id -- bump here, nowhere else, if the
// model ever changes. Opus, matching BRAIN_MODEL's tier (analytics/
// brainReview.ts): this runs once a week, synthesizing a whole period's
// scores into the narrative and role-play the owner's 30-minute Friday
// review leans on, so judgment quality matters more than per-call cost.
export const DIGEST_MODEL = 'claude-opus-4-8';

const SYSTEM_PROMPT = `You are a sales trainer writing the weekly digest for the owner of Yule Love Lights, a residential and commercial lighting company. The team is a player-coach plus a few office staff wearing every hat, nobody titled "salesperson" -- you are a supportive trainer, never a watchdog. This digest is read on a Friday, in about 30 minutes, to steer next week.

Write in a warm, plain, trainer voice. Celebrate improvement as loudly as the single best score -- nobody should read this and feel pinned to the bottom with no way to win. Cite real counts and percentages from the stats you are given (for example "3 of 5 calls named the customer's emotional state back" or "team average held at 74"). Never invent a number that is not in the data you were given.

The roughest moment is for a private one-on-one conversation, never a public callout. Frame it that way in the narrative: something worth sitting down with that rep about, not a mistake to broadcast.

Never use an em dash. Never use the words "unlock", "leverage", or "delve".

You will also be given the roughest real moment of the week (a real flagged fix: what happened, the transcript quote, the better line) when one exists. When it exists, build a role-play scenario from it: an anonymized customer persona and emotional state (never a real customer's name or address), a paraphrase of what the customer said or the moment that went wrong, and what good looks like (the better line plus which emotional-state track to run: vision-first for excited, done-for-you for busy, proof-and-guarantees for guarded, ambition-match for status buyers). When no roughest moment is given (an empty week, or a week where every scored call went well with nothing flagged), set role_play to null -- do not invent one.

In the emit_digest tool call, narrative and training_focus must be real JSON strings, and role_play must be either null or a real JSON object with setup, what_the_customer_says, and what_good_looks_like as real strings.`;

const EMIT_DIGEST_TOOL: Anthropic.Tool = {
  name: 'emit_digest',
  description: 'Return the weekly digest: a team-trends narrative, the training focus, and a role-play scenario built from the roughest real moment (or null if there is none).',
  input_schema: {
    type: 'object',
    properties: {
      narrative: {
        type: 'string',
        description:
          'Short plain-English team-trends narrative for the owner\'s Friday review: what is winning, what improved, the roughest moment framed as worth a private 1:1. No em dashes, never "unlock"/"leverage"/"delve".',
      },
      training_focus: {
        type: 'string',
        description: 'The week\'s training focus, derived from the three lowest-scoring dimensions given in the stats.',
      },
      role_play: {
        type: ['object', 'null'],
        description: 'A role-play scenario built from the roughest real moment, or null when there is none this week.',
        properties: {
          setup: { type: 'string', description: 'Anonymized customer persona and emotional state -- no real customer names or addresses.' },
          what_the_customer_says: { type: 'string', description: 'A paraphrase of the real objection or moment that went wrong.' },
          what_good_looks_like: { type: 'string', description: 'The better line to say, plus which emotional-state track to run.' },
        },
      },
    },
    required: ['narrative', 'training_focus', 'role_play'],
  },
};

export type RolePlay = { setup: string; whatTheCustomerSays: string; whatGoodLooksLike: string };
export type GeneratedDigest = { narrative: string; trainingFocus: string; rolePlay: RolePlay | null };

export type GenerateDigestInput = {
  stats: DigestStats;
  proposals: ProposalForDigest[];
};

type ValidationResult = { valid: true; digest: GeneratedDigest } | { valid: false; error: string };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateRolePlay(v: unknown): { valid: true; rolePlay: RolePlay | null } | { valid: false; error: string } {
  if (v === null || v === undefined) return { valid: true, rolePlay: null };
  if (typeof v !== 'object') return { valid: false, error: 'role_play must be an object or null.' };
  const o = v as Record<string, unknown>;
  if (!isNonEmptyString(o.setup) || !isNonEmptyString(o.what_the_customer_says) || !isNonEmptyString(o.what_good_looks_like)) {
    return { valid: false, error: 'role_play must have non-empty setup, what_the_customer_says, and what_good_looks_like.' };
  }
  return {
    valid: true,
    rolePlay: { setup: o.setup as string, whatTheCustomerSays: o.what_the_customer_says as string, whatGoodLooksLike: o.what_good_looks_like as string },
  };
}

function validateDigest(value: unknown): ValidationResult {
  if (typeof value !== 'object' || value === null) return { valid: false, error: 'Result must be an object.' };
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.narrative)) return { valid: false, error: 'narrative must be a non-empty string.' };
  if (!isNonEmptyString(v.training_focus)) return { valid: false, error: 'training_focus must be a non-empty string.' };
  const rolePlayCheck = validateRolePlay(v.role_play);
  if (!rolePlayCheck.valid) return { valid: false, error: rolePlayCheck.error };

  return {
    valid: true,
    digest: { narrative: (v.narrative as string).trim(), trainingFocus: (v.training_focus as string).trim(), rolePlay: rolePlayCheck.rolePlay },
  };
}

const MAX_ATTEMPTS = 2;
const MAX_TOKENS = 4000;

export async function generateWeeklyDigestNarrative(input: GenerateDigestInput): Promise<GeneratedDigest> {
  const client = getClaudeClient();
  if (!client) {
    throw new Error('Claude not configured. Set ANTHROPIC_API_KEY in .env.local');
  }

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        `Digest period: ${input.stats.periodStart} to ${input.stats.periodEnd}`,
        '',
        'Stats for this period:',
        JSON.stringify(input.stats, null, 2),
        '',
        'Pending playbook proposals the brain review produced this period:',
        input.proposals.length > 0 ? JSON.stringify(input.proposals, null, 2) : '(none this period)',
        '',
        'Write the weekly digest now.',
      ].join('\n'),
    },
  ];

  let lastError = 'unknown validation error';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await client.messages.create({
      model: DIGEST_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [EMIT_DIGEST_TOOL],
      tool_choice: { type: 'tool', name: 'emit_digest' },
      messages,
    });

    if (response.stop_reason === 'max_tokens') {
      throw new Error('Digest generation ran past the token limit; nothing was saved.');
    }

    const toolUse = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === 'emit_digest');
    if (!toolUse) {
      throw new Error('Claude did not return a digest.');
    }

    const checked = validateDigest(toolUse.input);
    if (checked.valid) {
      return checked.digest;
    }
    lastError = checked.error;

    if (attempt < MAX_ATTEMPTS) {
      const allToolUses = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
      messages.push(
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content: allToolUses.map(block => ({
            type: 'tool_result' as const,
            tool_use_id: block.id,
            is_error: true,
            content: `That result was rejected: ${checked.error} Call emit_digest again with a valid narrative, training_focus, and role_play.`,
          })),
        },
      );
    }
  }

  throw new Error(`Claude returned an invalid digest (${lastError}); nothing was saved.`);
}
