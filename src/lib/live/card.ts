// Generates one live coaching card using Claude's tool-use pattern to force
// structured output -- one tool (emit_card) whose input_schema is {card,
// expanded}, with tool_choice forcing that tool. Mirrors the
// normalize+validate+single-retry pattern proven in
// src/lib/playbook/generate.ts and src/lib/leads/followups.ts. This is the
// I/O boundary for the pure core in ./engine.ts (detectTriggers,
// buildCoachPrompt) -- same split as playbook/generate.ts vs
// playbook/normalize.ts+validate.ts.

import Anthropic from '@anthropic-ai/sdk';
import { getClaudeClient } from '../claude';
import { unwrapObjectStringArray } from '../playbook/normalize';
import { buildCoachPrompt, type Trigger } from './engine';
import type { Playbook } from '../playbook/types';

// Single exported const for the model id -- bump here, nowhere else, if the
// model ever changes. Haiku: this fires mid-call, so latency matters more
// than it does for the once-per-vertical playbook generation call.
export const COACH_MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are a live call coach whispering silent, glanceable guidance to a phone rep at Yule Love Lights, a residential and commercial lighting company, while a real call is happening. The rep reads your card mid-sentence, not after the call, so it must land in under two seconds. You never talk to the customer; only the rep sees you.

Ground every card strictly in the playbook and the transcript you are given. Do not invent company facts, pricing, or promises that are not in the playbook.

The card is 5-12 words, plain and direct, something a rep can glance at and immediately know what to do or say next. The expanded text is 1-3 short sentences giving the reasoning or a fuller line, for a rep who taps for more.

Never use an em dash. Never use the words "unlock", "leverage", or "delve".

In the emit_card tool call, card and expanded must be real JSON strings, never JSON-encoded, never wrapped in an object or an array.`;

const EMIT_CARD_TOOL: Anthropic.Tool = {
  name: 'emit_card',
  description: 'Return one live coaching card for the rep.',
  input_schema: {
    type: 'object',
    properties: {
      card: { type: 'string', description: 'A glanceable coaching cue, 5-12 words.' },
      expanded: { type: 'string', description: 'The fuller reasoning or line, 1-3 sentences.' },
    },
    required: ['card', 'expanded'],
  },
};

export type CoachCard = { card: string; expanded: string };

export type GenerateCoachCardInput = {
  trigger: Trigger;
  rollingTranscript: string;
  playbook: Playbook | null;
};

// Claude sometimes wraps a scalar string field in a single-key object
// ({text: "..."} / {value: "..."}) -- the same failure mode
// unwrapObjectStringArray already recovers for array fields
// (src/lib/playbook/normalize.ts). Reused here by lifting the scalar into a
// one-element array, unwrapping, then taking the element back out.
function unwrapScalarString(v: unknown): unknown {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return v;
  const unwrapped = unwrapObjectStringArray([v]);
  return Array.isArray(unwrapped) && typeof unwrapped[0] === 'string' ? unwrapped[0] : v;
}

export function normalizeCardInput(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return input;
  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const key of ['card', 'expanded'] as const) {
    if (key in out) out[key] = unwrapScalarString(out[key]);
  }
  return out;
}

type CardValidationResult = { valid: true; card: CoachCard } | { valid: false; error: string };

function validateCard(value: unknown): CardValidationResult {
  if (typeof value !== 'object' || value === null) {
    return { valid: false, error: 'Result must be an object.' };
  }
  const v = value as Record<string, unknown>;
  if (typeof v.card !== 'string' || !v.card.trim()) {
    return { valid: false, error: 'card must be a non-empty string.' };
  }
  if (typeof v.expanded !== 'string' || !v.expanded.trim()) {
    return { valid: false, error: 'expanded must be a non-empty string.' };
  }
  return { valid: true, card: { card: v.card.trim(), expanded: v.expanded.trim() } };
}

// One retry, same rationale as generatePlaybook/generateFollowups: sends the
// validation error back as a tool_result so the second attempt can correct
// itself.
const MAX_ATTEMPTS = 2;
// A 5-12 word card plus a 1-3 sentence expansion -- nowhere near Haiku's
// ceiling, and a low cap keeps a slow response from stalling the call.
const MAX_TOKENS = 512;

export async function generateCoachCard(input: GenerateCoachCardInput): Promise<CoachCard> {
  const client = getClaudeClient();
  if (!client) {
    throw new Error('Claude not configured. Set ANTHROPIC_API_KEY in .env.local');
  }

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: buildCoachPrompt(input.trigger, input.rollingTranscript, input.playbook) },
  ];

  let lastError = 'unknown validation error';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await client.messages.create({
      model: COACH_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [EMIT_CARD_TOOL],
      tool_choice: { type: 'tool', name: 'emit_card' },
      messages,
    });

    if (response.stop_reason === 'max_tokens') {
      throw new Error('Coaching card generation ran past the token limit.');
    }

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === 'emit_card',
    );
    if (!toolUse) {
      throw new Error('Claude did not return a coaching card.');
    }

    const checked = validateCard(normalizeCardInput(toolUse.input));
    if (checked.valid) {
      return checked.card;
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
            content: `That card was rejected: ${checked.error} Call emit_card again with card and expanded as real JSON strings, never wrapped in an object or array.`,
          })),
        },
      );
    }
  }

  throw new Error(`Claude returned an invalid coaching card (${lastError}).`);
}
