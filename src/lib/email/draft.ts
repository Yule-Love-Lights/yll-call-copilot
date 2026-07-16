// Generates the instantly-drafted inbound-email reply: one Claude call that
// both classifies intent and writes the reply, using the same forced
// tool-use + validate + single-retry pattern as
// src/lib/leads/followups.ts and src/lib/transcripts/distill.ts. Drafting
// itself never sends anything -- see src/lib/email/ingest.ts (the caller
// that resolves the playbook/guarantees and stores the result) and
// POST /api/inbox/[draftId]/send (the only send path, human-gated).

import Anthropic from '@anthropic-ai/sdk';
import { getClaudeClient } from '../claude';
import type { Playbook } from '../playbook/types';

// Single exported const for the model id -- bump here, nowhere else, if the
// model ever changes. Sonnet, not Haiku: this writes a real customer-facing
// email that bakes in the playbook and a guarantee, so writing quality
// matters more than the per-message cost (same tier choice as DISTILL_MODEL
// in transcripts/distill.ts, for the same reason).
export const EMAIL_REPLY_MODEL = 'claude-sonnet-5';

export type EmailReplyIntent = 'buyer' | 'question' | 'service' | 'other';
export const EMAIL_REPLY_INTENTS: EmailReplyIntent[] = ['buyer', 'question', 'service', 'other'];

export type GuaranteeOption = { key: string; text: string };

// Fallback guarantees used whenever the offer_versions table (sibling
// migration 0014) is missing, empty, or unreachable -- see
// src/lib/email/ingest.ts's loadGuarantees(). Text matches the two
// guarantees locked in docs/SALES-EXCELLENCE-PLAN.md section 2 verbatim.
export const DEFAULT_GUARANTEES: GuaranteeOption[] = [
  {
    key: 'fast_fix_48h',
    text: "If any section goes dark between Thanksgiving and New Year's, we fix it within 48 hours or that month is free.",
  },
  {
    key: 'all_inclusive',
    text: 'Design, install, all-season service, takedown, storage, all in the number. The quote is the bill. No hidden fees.',
  },
];

// Best-guess vertical for a lead with no known vertical_slug (every inbound
// email starts this way -- there is no lead/opportunity link yet). Defaults
// to holiday (the highest-volume vertical); a subject/body that clearly says
// permanent or event overrides it. Deliberately simple keyword matching, not
// a Claude call -- this only grounds which playbook/guarantee set to load,
// the drafting call itself does the real reading comprehension.
export function detectVerticalSlug(subject: string | null, body: string): 'holiday' | 'permanent' | 'event' {
  const text = `${subject ?? ''} ${body}`.toLowerCase();
  if (/permanent/.test(text)) return 'permanent';
  if (/event/.test(text)) return 'event';
  return 'holiday';
}

export const EMAIL_REPLY_SYSTEM_PROMPT = `You are writing a reply to an inbound customer email for Yule Love Lights, a residential and commercial lighting company (holiday lighting, permanent exterior lighting, event lighting, and commercial lighting). Write in a warm, personal, confident voice, like a real person who cares, never like a marketing team and never with pressure.

First classify the customer's intent as one of: buyer (genuinely interested in booking or getting a quote), question (a factual question, like service area or timing), service (an existing customer with a service or support need), or other.

Then write the reply, following the matched track:
- buyer: answer warmly, then add one low-pressure bridge to a quick call or booking with a concrete next step (for example, offering two times, or asking which day works). Never make the call feel mandatory.
- question or service: answer the question fully and specifically, right in the email. Leave the door open by name for anything else. Never force a call on this customer -- they chose email on purpose, and pushing a call here undoes the trust the answer just built.
- other: answer as warmly and specifically as the email allows, no call push.

Ground every claim in the email and playbook context you are given. Do not invent pricing, dates, or promises that are not in what you were given.

Weave in exactly one guarantee from the list you are given, wherever it fits naturally in the reply, and name which one you used (its key) as guarantee_used. Never weave in more than one, and never invent a guarantee that is not in the list.

Mirror the customer's own specifics (their name if given, what they actually asked) rather than a generic template. Sign off warm.

Never use an em dash. Never use the words "unlock", "leverage", or "delve". No throat-clearing openers like "In today's world" or "It's important to note" -- start with the substance. Plain words, short sentences.

In the emit_email_reply tool call, subject and body must be real strings, not JSON-encoded and not wrapped in XML tags.`;

const EMIT_EMAIL_REPLY_TOOL: Anthropic.Tool = {
  name: 'emit_email_reply',
  description: 'Return the classified intent and the drafted reply email.',
  input_schema: {
    type: 'object',
    properties: {
      intent: {
        type: 'string',
        enum: EMAIL_REPLY_INTENTS,
        description: 'buyer, question, service, or other.',
      },
      subject: { type: 'string', description: 'The reply subject line.' },
      body: { type: 'string', description: 'The reply email body.' },
      guarantee_used: { type: 'string', description: 'The key of the one guarantee woven into the reply.' },
    },
    required: ['intent', 'subject', 'body', 'guarantee_used'],
  },
};

export type GeneratedEmailReply = {
  intent: EmailReplyIntent;
  subject: string;
  body: string;
  guarantee_used: string;
};

export type GenerateEmailReplyInput = {
  fromName: string | null;
  subject: string | null;
  body: string;
  verticalName: string | null;
  playbook: Playbook | null;
  guarantees: GuaranteeOption[];
};

type EmailReplyValidationResult = { valid: true; reply: GeneratedEmailReply } | { valid: false; error: string };

export function validateEmailReply(value: unknown): EmailReplyValidationResult {
  if (typeof value !== 'object' || value === null) {
    return { valid: false, error: 'Result must be an object.' };
  }
  const v = value as Record<string, unknown>;

  if (typeof v.intent !== 'string' || !(EMAIL_REPLY_INTENTS as string[]).includes(v.intent)) {
    return { valid: false, error: 'intent must be one of buyer|question|service|other.' };
  }
  if (typeof v.subject !== 'string' || !v.subject.trim()) {
    return { valid: false, error: 'subject must be a non-empty string.' };
  }
  if (typeof v.body !== 'string' || !v.body.trim()) {
    return { valid: false, error: 'body must be a non-empty string.' };
  }
  if (typeof v.guarantee_used !== 'string' || !v.guarantee_used.trim()) {
    return { valid: false, error: 'guarantee_used must name which guarantee was used.' };
  }

  return {
    valid: true,
    reply: { intent: v.intent as EmailReplyIntent, subject: v.subject, body: v.body, guarantee_used: v.guarantee_used },
  };
}

const MAX_ATTEMPTS = 2;
// A subject + a short-to-medium email body, nowhere near Sonnet's ceiling.
const MAX_TOKENS = 2048;

export async function generateEmailReply(input: GenerateEmailReplyInput): Promise<GeneratedEmailReply> {
  const client = getClaudeClient();
  if (!client) {
    throw new Error('Claude not configured. Set ANTHROPIC_API_KEY in .env.local');
  }

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        `Customer name: ${input.fromName ?? '(name unknown)'}`,
        `Subject: ${input.subject ?? '(no subject)'}`,
        'Email body:',
        input.body,
        '',
        `Vertical: ${input.verticalName ?? '(not set -- assume holiday lighting)'}`,
        'Playbook context:',
        input.playbook ? JSON.stringify(input.playbook, null, 2) : '(no active playbook for this vertical)',
        '',
        'Guarantees available to weave in (pick exactly one, name its key as guarantee_used):',
        JSON.stringify(input.guarantees, null, 2),
        '',
        'Write the reply email now.',
      ].join('\n'),
    },
  ];

  let lastError = 'unknown validation error';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await client.messages.create({
      model: EMAIL_REPLY_MODEL,
      max_tokens: MAX_TOKENS,
      system: EMAIL_REPLY_SYSTEM_PROMPT,
      tools: [EMIT_EMAIL_REPLY_TOOL],
      tool_choice: { type: 'tool', name: 'emit_email_reply' },
      messages,
    });

    if (response.stop_reason === 'max_tokens') {
      throw new Error('Email reply generation ran past the token limit; nothing was saved.');
    }

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === 'emit_email_reply',
    );
    if (!toolUse) {
      throw new Error('Claude did not return an email reply.');
    }

    const checked = validateEmailReply(toolUse.input);
    if (checked.valid) {
      return checked.reply;
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
            content: `That result was rejected: ${checked.error} Call emit_email_reply again with a valid reply.`,
          })),
        },
      );
    }
  }

  throw new Error(`Claude returned an invalid email reply (${lastError}); nothing was saved.`);
}
