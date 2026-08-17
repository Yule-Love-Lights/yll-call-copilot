// Extracts rep commitments from one transcript using Claude's tool-use
// pattern to force structured output -- same shape as
// src/lib/transcripts/extract.ts's extractLearnings (one tool, tool_choice
// forced, normalize-validate-single-retry). Mirrored rather than shared for
// the same reason as that file states: the two schemas don't overlap enough
// to make a generic helper simpler than two small, readable copies. #217

import Anthropic from '@anthropic-ai/sdk';
import { getClaudeClient } from '../claude';
import { truncateTranscript } from '../transcripts/extract';
import { COMMITMENT_KINDS } from './types';
import type { RawCommitment } from './types';

// Haiku, not Sonnet -- same rationale as EXTRACT_MODEL in
// src/lib/transcripts/extract.ts: this runs once per transcript across a
// backfill of up to ~2000 calls, so cost per call matters far more than it
// does for a one-off generation call.
export const EXTRACT_MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are reviewing one real sales-call transcript for Yule Love Lights, a residential and commercial lighting company. Extract only PROMISES THE REP MADE to the customer during this call -- something the rep committed to doing after the call (sending a quote, sending photos, calling back, scheduling an estimate, sending information, or another concrete promise).

Never extract something the CUSTOMER said they would do ("I'll think about it and call you back", "let me talk to my spouse") -- that is not a rep commitment. Never extract a hypothetical or something the rep only floated as an option ("I could send you photos if you want") unless the rep actually committed to doing it. Never extract something the rep says they have ALREADY DONE ("I sent you that quote yesterday", "I already texted you the photos, did you get them?") -- that is a completed action, not an open commitment, even though the rep is talking about the same kind of thing (a quote, photos, a callback). When in doubt, leave it out.

If the rep mentioned a specific time they promised to do something (e.g. "I'll call you back around 3", "I'll send that over tonight"), extract promised_time_local as a 24-hour HH:MM local time in America/New_York (the call's own time zone), and promised_day_offset as how many days after the call date it falls (0 for later today, 1 for tomorrow). If no specific time was mentioned, leave both null.

If a call has no rep commitments, return an empty commitments array. Never invent a commitment that is not actually in the transcript.

Never use an em dash. Never use the words "unlock", "leverage", or "delve".`;

const EMIT_COMMITMENTS_TOOL: Anthropic.Tool = {
  name: 'emit_commitments',
  description: 'Return the rep commitments extracted from this call transcript.',
  input_schema: {
    type: 'object',
    properties: {
      commitments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: COMMITMENT_KINDS,
              description: 'The type of thing the rep promised.',
            },
            detail: {
              type: 'string',
              description: 'A short plain-English description of exactly what the rep promised, e.g. "send the quote for the roofline package".',
            },
            promised_time_local: {
              anyOf: [{ type: 'string' }, { type: 'null' }],
              description: '24-hour HH:MM local time in America/New_York the rep promised, only if a specific time was mentioned. Null otherwise.',
            },
            promised_day_offset: {
              anyOf: [{ type: 'integer' }, { type: 'null' }],
              description: 'Days after the call date this falls on: 0 for later today, 1 for tomorrow. Null if no specific time was mentioned.',
            },
          },
          required: ['kind', 'detail', 'promised_time_local', 'promised_day_offset'],
        },
        description: 'Rep commitments made on this call. Empty array if none.',
      },
    },
    required: ['commitments'],
  },
};

function isCommitmentKind(v: unknown): v is RawCommitment['kind'] {
  return typeof v === 'string' && (COMMITMENT_KINDS as string[]).includes(v);
}
function isNullableString(v: unknown): v is string | null {
  return typeof v === 'string' || v === null;
}
function isNullableInt(v: unknown): v is number | null {
  return v === null || (typeof v === 'number' && Number.isInteger(v));
}

type ValidationResult = { valid: true; commitments: RawCommitment[] } | { valid: false; error: string };

function validateCommitments(value: unknown): ValidationResult {
  if (typeof value !== 'object' || value === null) {
    return { valid: false, error: 'Response must be an object.' };
  }
  const commitments = (value as Record<string, unknown>).commitments;
  if (!Array.isArray(commitments)) {
    return { valid: false, error: 'commitments must be an array.' };
  }

  const result: RawCommitment[] = [];
  for (const c of commitments) {
    if (typeof c !== 'object' || c === null) {
      return { valid: false, error: 'Each commitment must be an object.' };
    }
    const r = c as Record<string, unknown>;
    if (!isCommitmentKind(r.kind)) {
      return { valid: false, error: `kind must be one of ${COMMITMENT_KINDS.join(', ')}.` };
    }
    if (typeof r.detail !== 'string' || !r.detail.trim()) {
      return { valid: false, error: 'detail must be a non-empty string.' };
    }
    if (!isNullableString(r.promised_time_local)) {
      return { valid: false, error: 'promised_time_local must be a string or null.' };
    }
    if (!isNullableInt(r.promised_day_offset)) {
      return { valid: false, error: 'promised_day_offset must be an integer or null.' };
    }
    result.push({
      kind: r.kind,
      detail: r.detail,
      promised_time_local: r.promised_time_local,
      promised_day_offset: r.promised_day_offset,
    });
  }
  return { valid: true, commitments: result };
}

// One retry, same rationale as extractLearnings: sends the validation error
// back as a tool_result so the second attempt can correct itself.
const MAX_ATTEMPTS = 2;
// Small structured-extraction call -- an array of short objects, nowhere
// near Haiku's ceiling. MAX_TOKENS_RETRY is the same one-shot headroom bump
// extractLearnings uses before giving up entirely.
const MAX_TOKENS = 2048;
const MAX_TOKENS_RETRY = 4096;

export async function extractRawCommitments(transcript: string, verticalName: string): Promise<RawCommitment[]> {
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
        'Extract the rep commitments from this call now.',
      ].join('\n'),
    },
  ];

  const callExtract = (maxTokens: number) =>
    client.messages.create({
      model: EXTRACT_MODEL,
      max_tokens: maxTokens,
      system: SYSTEM_PROMPT,
      tools: [EMIT_COMMITMENTS_TOOL],
      tool_choice: { type: 'tool', name: 'emit_commitments' },
      messages,
    });

  let lastError = 'unknown validation error';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response = await callExtract(MAX_TOKENS);

    if (response.stop_reason === 'max_tokens') {
      response = await callExtract(MAX_TOKENS_RETRY);
      if (response.stop_reason === 'max_tokens') {
        throw new Error('Commitment extraction ran past the token limit; nothing was saved.');
      }
    }

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === 'emit_commitments',
    );
    if (!toolUse) {
      throw new Error('Claude did not return commitments.');
    }

    const checked = validateCommitments(toolUse.input);
    if (checked.valid) {
      return checked.commitments;
    }
    lastError = checked.error;

    if (attempt < MAX_ATTEMPTS) {
      messages.push(
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result' as const,
              tool_use_id: toolUse.id,
              is_error: true,
              content: `That result was rejected: ${checked.error} Call emit_commitments again with every field as real JSON of its declared type.`,
            },
          ],
        },
      );
    }
  }

  throw new Error(`Claude returned incomplete commitments (${lastError}); nothing was saved.`);
}
