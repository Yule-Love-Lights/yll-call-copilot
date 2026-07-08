// Extracts structured sales-call learnings from one transcript using
// Claude's tool-use pattern to force structured output — one tool
// (emit_learnings) whose input_schema mirrors the `learnings` table's
// jsonb/text columns, with tool_choice forcing that tool. Mirrors the
// normalize+validate+single-retry pattern proven in
// src/lib/playbook/generate.ts. Mirrored rather than shared: the two
// schemas don't overlap enough to make a generic helper simpler than two
// small, readable copies.

import Anthropic from '@anthropic-ai/sdk';
import { getClaudeClient } from '../claude';
import { unwrapObjectStringArray } from '../playbook/normalize';
import type { Learnings, Objection } from './types';

// Single exported const for the model id — bump here, nowhere else, if the
// model ever changes. This is Haiku, not Sonnet: extraction runs once per
// transcript (up to ~2000 per ingest), so cost per call matters far more
// than it does for the one-off playbook generation call.
export const EXTRACT_MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are a veteran sales-call analyst for a residential and commercial lighting company, Yule Love Lights (holiday lighting, permanent exterior lighting, event lighting, and commercial lighting). You read one real call transcript between a rep and a homeowner or business owner and extract only what is actually in the transcript. Never invent an objection, phrase, or outcome that is not there.

customer_words must be the customer's own words, verbatim or as close to verbatim as the transcript allows. Never paraphrase a customer's words into your own.

If a field has nothing to report for this call, return an empty array (or an empty string for summary) rather than inventing content to fill it.

Never use an em dash. Never use the words "unlock", "leverage", or "delve".

In the emit_learnings tool call, every field must be real JSON of its declared type. Arrays must be JSON arrays with one element per item, never a single string and never items wrapped in XML tags like <item>. Objects must be JSON objects.`;

const EMIT_LEARNINGS_TOOL: Anthropic.Tool = {
  name: 'emit_learnings',
  description: 'Return the structured learnings extracted from this call transcript.',
  input_schema: {
    type: 'object',
    properties: {
      objections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            objection: { type: 'string', description: 'The objection in a few plain words, e.g. "price too high".' },
            customer_words: { type: 'string', description: "The customer's own words raising it, verbatim where possible." },
            rep_response: { type: 'string', description: 'How the rep actually responded on this call.' },
            worked: {
              anyOf: [{ type: 'boolean' }, { type: 'null' }],
              description: 'true if the objection was overcome, false if it ended the call, null if unclear from the transcript.',
            },
          },
          required: ['objection', 'customer_words', 'rep_response', 'worked'],
        },
        description: 'Objections the customer raised on this call.',
      },
      customer_language: {
        type: 'array',
        items: { type: 'string' },
        description: 'Notable phrases the customer used, verbatim, that reveal how they think or talk about the purchase.',
      },
      what_worked: {
        type: 'array',
        items: { type: 'string' },
        description: 'Rep moves, angles, or phrases that visibly moved this call forward.',
      },
      what_failed: {
        type: 'array',
        items: { type: 'string' },
        description: 'Rep moves, angles, or phrases that visibly fell flat or backfired on this call.',
      },
      price_talk: {
        type: 'array',
        items: { type: 'string' },
        description: 'Short snippets of how price or cost came up and was discussed.',
      },
      questions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Questions the customer asked, verbatim or close to it.',
      },
      summary: {
        type: 'string',
        description: 'A 1-3 sentence plain-English summary of the call.',
      },
    },
    required: ['objections', 'customer_language', 'what_worked', 'what_failed', 'price_talk', 'questions', 'summary'],
  },
};

// Keeps Haiku's input cheap on long calls: full transcripts add cost with
// little extraction value in the middle, so we keep the opening (where
// rapport/angle/price usually surface) and the close (where the outcome and
// final objection usually land) and drop the middle behind a marker.
const MAX_TRANSCRIPT_CHARS = 12000;
const HEAD_CHARS = 8000;
const TAIL_CHARS = 4000;
const TRUNCATION_MARKER = '\n\n[... transcript truncated for length ...]\n\n';

export function truncateTranscript(text: string): string {
  if (text.length <= MAX_TRANSCRIPT_CHARS) return text;
  return text.slice(0, HEAD_CHARS) + TRUNCATION_MARKER + text.slice(text.length - TAIL_CHARS);
}

// Same recovery as normalizePlaybookInput (src/lib/playbook/normalize.ts):
// Claude occasionally fills a tool-call array field with a JSON-encoded
// string or XML-tagged text instead of a real JSON array. Recover the two
// obvious cases before validation; anything else still fails validation and
// goes to the one retry.
const LEARNINGS_STRING_ARRAY_KEYS = new Set([
  'customer_language',
  'what_worked',
  'what_failed',
  'price_talk',
  'questions',
]);

function normalizeLearningsInput(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return input;
  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };

  for (const key of [
    'objections',
    'customer_language',
    'what_worked',
    'what_failed',
    'price_talk',
    'questions',
  ] as const) {
    const v = out[key];

    // String-array fields that arrived as arrays of wrapped-string objects
    // ([{text:"x"}] / one-key objects) — same recovery as the playbook side.
    if (LEARNINGS_STRING_ARRAY_KEYS.has(key) && Array.isArray(v)) {
      out[key] = unwrapObjectStringArray(v);
      continue;
    }

    if (typeof v !== 'string') continue;
    const s = v.trim();

    if (s.startsWith('[') || s.startsWith('{')) {
      try {
        out[key] = JSON.parse(s);
        continue;
      } catch {
        // fall through to the tag scan
      }
    }

    const tagged = [...s.matchAll(/<([a-zA-Z_]+)>([\s\S]*?)<\/\1>/g)].map(m => m[2].trim());
    if (tagged.length > 0) out[key] = tagged;
  }

  return out;
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}
function isNullableBoolean(v: unknown): v is boolean | null {
  return typeof v === 'boolean' || v === null;
}
function isObjectionArray(v: unknown): v is Objection[] {
  return (
    Array.isArray(v) &&
    v.every(o => {
      if (typeof o !== 'object' || o === null) return false;
      const r = o as Record<string, unknown>;
      return isString(r.objection) && isString(r.customer_words) && isString(r.rep_response) && isNullableBoolean(r.worked);
    })
  );
}

type LearningsValidationResult = { valid: true; learnings: Learnings } | { valid: false; error: string };

function validateLearnings(value: unknown): LearningsValidationResult {
  if (typeof value !== 'object' || value === null) {
    return { valid: false, error: 'Learnings must be an object.' };
  }
  const v = value as Record<string, unknown>;

  if (!isObjectionArray(v.objections)) {
    return {
      valid: false,
      error: 'objections must be an array of { objection, customer_words, rep_response, worked }.',
    };
  }
  if (!isStringArray(v.customer_language)) {
    return { valid: false, error: 'customer_language must be an array of strings.' };
  }
  if (!isStringArray(v.what_worked)) {
    return { valid: false, error: 'what_worked must be an array of strings.' };
  }
  if (!isStringArray(v.what_failed)) {
    return { valid: false, error: 'what_failed must be an array of strings.' };
  }
  if (!isStringArray(v.price_talk)) {
    return { valid: false, error: 'price_talk must be an array of strings.' };
  }
  if (!isStringArray(v.questions)) {
    return { valid: false, error: 'questions must be an array of strings.' };
  }
  if (!isString(v.summary)) {
    return { valid: false, error: 'summary must be a string.' };
  }

  return {
    valid: true,
    learnings: {
      objections: v.objections,
      customer_language: v.customer_language,
      what_worked: v.what_worked,
      what_failed: v.what_failed,
      price_talk: v.price_talk,
      questions: v.questions,
      summary: v.summary,
    },
  };
}

// One retry, same rationale as generatePlaybook: sends the validation error
// back as a tool_result so the second attempt can correct itself.
const MAX_ATTEMPTS = 2;
// Small structured-extraction call — the schema is a handful of short
// arrays plus a 1-3 sentence summary, nowhere near Haiku's 64K ceiling.
const MAX_TOKENS = 4096;

export async function extractLearnings(transcript: string, verticalName: string): Promise<Learnings> {
  const client = getClaudeClient();
  if (!client) {
    throw new Error('Claude not configured. Set ANTHROPIC_API_KEY in .env.local');
  }

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        `Vertical: ${verticalName}`,
        '',
        'Call transcript:',
        truncateTranscript(transcript),
        '',
        'Extract the learnings from this call now.',
      ].join('\n'),
    },
  ];

  let lastError = 'unknown validation error';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await client.messages.create({
      model: EXTRACT_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [EMIT_LEARNINGS_TOOL],
      tool_choice: { type: 'tool', name: 'emit_learnings' },
      messages,
    });

    if (response.stop_reason === 'max_tokens') {
      throw new Error('Learnings extraction ran past the token limit; nothing was saved.');
    }

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === 'emit_learnings',
    );
    if (!toolUse) {
      throw new Error('Claude did not return learnings.');
    }

    const checked = validateLearnings(normalizeLearningsInput(toolUse.input));
    if (checked.valid) {
      return checked.learnings;
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
            content: `That result was rejected: ${checked.error} Call emit_learnings again with every field as real JSON of its declared type. Arrays must be JSON arrays, one element per item, no XML tags, no JSON-encoded strings. String-array fields must contain plain strings, never objects.`,
          })),
        },
      );
    }
  }

  throw new Error(`Claude returned incomplete learnings (${lastError}); nothing was saved.`);
}
