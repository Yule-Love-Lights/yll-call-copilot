// Scans one transcript's raw_text for warm, service-relevant personal
// details worth remembering (kid/pet names, a party or event date, "first
// Christmas in the new house", anniversaries, health/life events mentioned
// warmly) using Claude's tool-use pattern to force structured output, same
// normalize+validate+single-retry shape as src/lib/transcripts/extract.ts and
// src/lib/transcripts/distill.ts.

import Anthropic from '@anthropic-ai/sdk';
import { getClaudeClient } from '../claude';
import type { PersonalTouchDetail } from './types';

// Single exported const for the model id -- bump here, nowhere else, if the
// model ever changes. Haiku: a cheap extraction scan run over up to 10
// transcripts a night, same cost rationale as EXTRACT_MODEL.
export const TOUCH_MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are reading a real sales-call transcript for a residential and commercial lighting company, Yule Love Lights, looking for personal details a genuinely warm host would remember about this customer -- the kind of thing that makes someone feel known, not surveilled.

Only flag: a kid's or pet's name, a party or event date, "first Christmas in the new house" or similar milestone, an anniversary, or a health or life event mentioned warmly and in passing (e.g. "my mother is coming to stay for the holidays," "we just had our first baby").

Never flag a sensitive attribute: no health diagnoses, no financial details, no religion beyond a plain holiday-season mention, and nothing a customer would find creepy or surveillance-like to see written down. If a call has nothing worth remembering, return an empty array -- that is a correct and common answer, not a failure.

quote must be the customer's own words, verbatim or as close to verbatim as the transcript allows. Never paraphrase a customer's words into your own.

Never use an em dash. Never use the words "unlock", "leverage", or "delve".

In the emit_touches tool call, touches must be a real JSON array of objects, never a single string and never items wrapped in XML tags.`;

const EMIT_TOUCHES_TOOL: Anthropic.Tool = {
  name: 'emit_touches',
  description: 'Return the personal touches worth remembering from this call transcript, or an empty array if none.',
  input_schema: {
    type: 'object',
    properties: {
      touches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            detail: { type: 'string', description: 'The detail worth remembering, in a few plain words.' },
            category: {
              type: 'string',
              description: 'A short category label, e.g. "kid", "pet", "occasion", "milestone", "anniversary", "life event".',
            },
            quote: { type: 'string', description: "The customer's own words raising it, verbatim where possible." },
          },
          required: ['detail', 'category', 'quote'],
        },
        description: 'Warm, service-relevant personal details found in this call. Empty array if none.',
      },
    },
    required: ['touches'],
  },
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isTouchShape(v: unknown): v is PersonalTouchDetail {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return isNonEmptyString(r.detail) && isNonEmptyString(r.category) && isNonEmptyString(r.quote);
}

export type TouchesValidationResult = { valid: true; touches: PersonalTouchDetail[] } | { valid: false; error: string };

export function validateTouches(value: unknown): TouchesValidationResult {
  if (typeof value !== 'object' || value === null) {
    return { valid: false, error: 'Result must be an object.' };
  }
  const raw = (value as Record<string, unknown>).touches;
  if (!Array.isArray(raw)) {
    return { valid: false, error: 'touches must be an array.' };
  }

  const touches: PersonalTouchDetail[] = [];
  for (const item of raw) {
    if (!isTouchShape(item)) {
      return { valid: false, error: 'each touch must be an object with non-empty detail, category, and quote strings.' };
    }
    touches.push({ detail: item.detail, category: item.category, quote: item.quote });
  }

  return { valid: true, touches };
}

const MAX_ATTEMPTS = 2;
// A handful of short {detail, category, quote} objects at most -- nowhere
// near Haiku's ceiling.
const MAX_TOKENS = 2048;

export async function scanPersonalTouches(transcriptText: string, customerName: string | null): Promise<PersonalTouchDetail[]> {
  const client = getClaudeClient();
  if (!client) {
    throw new Error('Claude not configured. Set ANTHROPIC_API_KEY in .env.local');
  }

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        `Customer: ${customerName ?? '(name unknown)'}`,
        '',
        'Call transcript:',
        transcriptText,
        '',
        'Extract the personal touches from this call now, or return an empty array if there is nothing worth remembering.',
      ].join('\n'),
    },
  ];

  let lastError = 'unknown validation error';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await client.messages.create({
      model: TOUCH_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [EMIT_TOUCHES_TOOL],
      tool_choice: { type: 'tool', name: 'emit_touches' },
      messages,
    });

    if (response.stop_reason === 'max_tokens') {
      throw new Error('Personal-touch scan ran past the token limit; nothing was saved.');
    }

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === 'emit_touches',
    );
    if (!toolUse) {
      throw new Error('Claude did not return a touches array.');
    }

    const checked = validateTouches(toolUse.input);
    if (checked.valid) {
      return checked.touches;
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
            content: `That result was rejected: ${checked.error} Call emit_touches again with a valid touches array, every item a real JSON object with non-empty detail, category, and quote strings.`,
          })),
        },
      );
    }
  }

  throw new Error(`Claude returned an invalid touches array (${lastError}); nothing was saved.`);
}
