// Generates the post-call follow-up drafts (one email, one SMS) using
// Claude's tool-use pattern to force structured output — one tool
// (emit_followups) whose input_schema mirrors the `followups` table's
// content columns, with tool_choice forcing that tool. Mirrors the
// normalize+validate+single-retry pattern proven in
// src/lib/playbook/generate.ts and src/lib/transcripts/extract.ts.

import Anthropic from '@anthropic-ai/sdk';
import { getClaudeClient } from '../claude';
import type { Playbook } from '../playbook/types';
import type { CallOutcome } from './types';

// Single exported const for the model id — bump here, nowhere else, if the
// model ever changes. Haiku, not Sonnet: this is a short, templated draft
// grounded in the call notes and playbook, not open-ended synthesis.
export const FOLLOWUP_MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are writing a follow-up email and text message right after a real phone call for Yule Love Lights, a residential and commercial lighting company (holiday lighting, permanent exterior lighting, event lighting, and commercial lighting). Write in a friendly homeowner voice, like a real person who just talked to them, not a marketing team.

Ground the message in the call notes and outcome you are given, and in the playbook context if any is provided. Do not invent pricing, dates, or promises that are not in what you were given.

The email must have a short, specific subject line and a short, warm body. The SMS must be under 320 characters, plain text, no links unless one was explicitly in the notes.

Never use an em dash. Never use the words "unlock", "leverage", or "delve".

In the emit_followups tool call, email must be a real JSON object with subject and body as strings, and sms must be a real JSON string. Never JSON-encode either as a string and never wrap them in XML tags.`;

const EMIT_FOLLOWUPS_TOOL: Anthropic.Tool = {
  name: 'emit_followups',
  description: 'Return the follow-up email and SMS draft for this call.',
  input_schema: {
    type: 'object',
    properties: {
      email: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'A short, specific subject line.' },
          body: { type: 'string', description: 'The email body, friendly and short.' },
        },
        required: ['subject', 'body'],
      },
      sms: {
        type: 'string',
        description: 'The SMS draft. Must be under 320 characters.',
      },
    },
    required: ['email', 'sms'],
  },
};

export type GeneratedFollowups = { email: { subject: string; body: string }; sms: string };

export type GenerateFollowupsInput = {
  contactName: string | null;
  verticalName: string | null;
  outcome: CallOutcome;
  notes: string;
  playbook: Playbook | null;
};

// Same recovery as normalizePlaybookInput (src/lib/playbook/normalize.ts):
// Claude occasionally fills a tool-call object field with a JSON-encoded
// string instead of a real JSON object.
function normalizeFollowupsInput(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return input;
  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  if (typeof out.email === 'string') {
    const trimmed = out.email.trim();
    if (trimmed.startsWith('{')) {
      try {
        out.email = JSON.parse(trimmed);
      } catch {
        // fall through — validation will reject it with a clear message
      }
    }
  }
  return out;
}

function isEmailShape(v: unknown): v is { subject: string; body: string } {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>).subject === 'string' &&
    typeof (v as Record<string, unknown>).body === 'string'
  );
}

type FollowupsValidationResult = { valid: true; followups: GeneratedFollowups } | { valid: false; error: string };

function validateFollowups(value: unknown): FollowupsValidationResult {
  if (typeof value !== 'object' || value === null) {
    return { valid: false, error: 'Result must be an object.' };
  }
  const v = value as Record<string, unknown>;

  if (!isEmailShape(v.email)) {
    return { valid: false, error: 'email must be an object with subject and body strings.' };
  }
  if (typeof v.sms !== 'string' || !v.sms.trim()) {
    return { valid: false, error: 'sms must be a non-empty string.' };
  }
  if (v.sms.length > 320) {
    return { valid: false, error: 'sms must be 320 characters or fewer.' };
  }

  return { valid: true, followups: { email: { subject: v.email.subject, body: v.email.body }, sms: v.sms } };
}

const MAX_ATTEMPTS = 2;
// A subject, a short body, and one SMS — nowhere near Haiku's ceiling.
const MAX_TOKENS = 2048;

export async function generateFollowups(input: GenerateFollowupsInput): Promise<GeneratedFollowups> {
  const client = getClaudeClient();
  if (!client) {
    throw new Error('Claude not configured. Set ANTHROPIC_API_KEY in .env.local');
  }

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        `Contact: ${input.contactName ?? '(name unknown)'}`,
        `Vertical: ${input.verticalName ?? '(not set)'}`,
        `Call outcome: ${input.outcome}`,
        `Call notes: ${input.notes.trim() || '(no notes taken)'}`,
        '',
        'Playbook context:',
        input.playbook ? JSON.stringify(input.playbook, null, 2) : '(no active playbook for this vertical)',
        '',
        'Write the follow-up email and SMS draft now.',
      ].join('\n'),
    },
  ];

  let lastError = 'unknown validation error';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await client.messages.create({
      model: FOLLOWUP_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [EMIT_FOLLOWUPS_TOOL],
      tool_choice: { type: 'tool', name: 'emit_followups' },
      messages,
    });

    if (response.stop_reason === 'max_tokens') {
      throw new Error('Follow-up generation ran past the token limit; nothing was saved.');
    }

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === 'emit_followups',
    );
    if (!toolUse) {
      throw new Error('Claude did not return follow-up drafts.');
    }

    const checked = validateFollowups(normalizeFollowupsInput(toolUse.input));
    if (checked.valid) {
      return checked.followups;
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
            content: `That result was rejected: ${checked.error} Call emit_followups again with email as a real JSON object and sms as a real JSON string under 320 characters.`,
          })),
        },
      );
    }
  }

  throw new Error(`Claude returned invalid follow-up drafts (${lastError}); nothing was saved.`);
}
