// Turns a vertical description into a full call playbook using Claude's
// tool-use pattern to force structured output: one tool (emit_playbook) whose
// input_schema mirrors the Playbook type, with tool_choice forcing that tool
// so the response is always parseable — never free-text that needs scraping.

import Anthropic from '@anthropic-ai/sdk';
import { getClaudeClient } from '../claude';
import { normalizePlaybookInput } from './normalize';
import { validatePlaybook } from './validate';
import type { Playbook } from './types';

// Single exported const for the model id — bump here, nowhere else, if the
// model ever changes.
export const PLAYBOOK_MODEL = 'claude-sonnet-5';

const SYSTEM_PROMPT = `You are a veteran coach for inbound and warm outbound calling at Yule Love Lights, a residential and commercial lighting company (holiday lighting, permanent exterior lighting, event lighting, and commercial lighting). You are writing a call playbook that a human rep will use on real phone calls to homeowners and local businesses. Most calls are warm: the person called us, requested a quote, is a past customer, was referred, or is due for a seasonal rebook. True cold calls are the rare exception.

Never use B2B-SaaS language ("solutions", "synergy", "stakeholders", "value prop", and similar). This is a lighting company talking to homeowners and business owners, not a software pitch.

Every script must be made of short sentences a rep can actually say out loud on a call. Prefer warm re-engagement of past customers over pressure tactics or urgency gimmicks.

Ground every part of the playbook in the vertical description and knowledge notes the user provides. Do not invent company facts that contradict what you are given.

Openers must include these five variants: one labeled "Inbound follow-up" (they contacted us or requested a quote), one labeled "Past customer" (re-engagement or upsell), one labeled "Quote follow-up" (quote sent, no decision yet), one labeled "Neighbor install / referral", and one labeled "Cold" for the rare true-cold call.

Objections must cover at least these five: price, "not interested", "email me info", talking to a spouse or other decision-maker, and bad timing.

The voicemail script must be short enough for a rep to speak in under 20 seconds.

Never use an em dash. Never use the words "unlock", "leverage", or "delve".

In the emit_playbook tool call, every field must be real JSON of its declared type. Arrays must be JSON arrays with one element per item, never a single string and never items wrapped in XML tags like <angle>. Objects must be JSON objects.`;

const EMIT_PLAYBOOK_TOOL: Anthropic.Tool = {
  name: 'emit_playbook',
  description: 'Return the completed call playbook for this vertical as structured data.',
  input_schema: {
    type: 'object',
    properties: {
      icp: {
        type: 'string',
        description: 'Ideal customer profile for this vertical, in plain English.',
      },
      angles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Call angles or reasons to call, specific to this vertical.',
      },
      openers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: {
              type: 'string',
              description: 'Scenario label, e.g. "Inbound follow-up" or "Past customer".',
            },
            script: {
              type: 'string',
              description: 'The spoken opener, as short sentences a rep can say out loud.',
            },
          },
          required: ['label', 'script'],
        },
        description:
          'Opener scripts. Must include exactly these labels: "Inbound follow-up", "Past customer", "Quote follow-up", "Neighbor install / referral", and "Cold".',
      },
      objections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            objection: { type: 'string' },
            response: { type: 'string' },
          },
          required: ['objection', 'response'],
        },
        description:
          'Common objections and the spoken response. Must cover at least: price, "not interested", "email me info", spouse/decision-maker, and bad timing.',
      },
      avoid: {
        type: 'array',
        items: { type: 'string' },
        description: 'Things the rep should never say on a call for this vertical.',
      },
      voicemail: {
        type: 'string',
        description: 'A voicemail script, short enough to speak in under 20 seconds.',
      },
    },
    required: ['icp', 'angles', 'openers', 'objections', 'avoid', 'voicemail'],
  },
};

export type GeneratePlaybookInput = {
  name: string;
  description: string;
  knowledgeNotes: string;
  // Phase 1.5 knowledge documents (src/lib/transcripts). Optional and
  // backward compatible: omitting it reproduces the exact Phase 1 message.
  documents?: { title: string; content: string }[];
};

// Renders the "Reference documents:" block appended to the generation
// prompt. Docs are capped at ~20k total chars so a big upload doesn't blow
// up the request — callers pass documents oldest-first (their created_at
// order), and this keeps the NEWEST ones when trimming to the cap ("truncate
// oldest first"). The single newest document is always included in full
// even if it alone exceeds the cap — knowledge docs are meant to be
// reference notes, not novels, so that edge case is left unhandled rather
// than adding mid-document truncation for a case that shouldn't come up.
const DOCUMENTS_CHAR_CAP = 20000;

export function buildDocumentsSection(documents: { title: string; content: string }[]): string {
  if (documents.length === 0) return '';

  const kept: { title: string; content: string }[] = [];
  let used = 0;
  for (let i = documents.length - 1; i >= 0; i--) {
    const doc = documents[i];
    const block = `Title: ${doc.title}\n${doc.content}`;
    if (used + block.length > DOCUMENTS_CHAR_CAP && kept.length > 0) break;
    kept.unshift(doc);
    used += block.length;
  }

  return kept.map(doc => `Title: ${doc.title}\n${doc.content}`).join('\n\n');
}

// One retry: live runs showed the model occasionally fills array fields with
// XML-tagged strings. The retry sends the validation error back as a
// tool_result so the second attempt can correct itself.
const MAX_ATTEMPTS = 2;

export async function generatePlaybook(input: GeneratePlaybookInput): Promise<Playbook> {
  const client = getClaudeClient();
  if (!client) {
    throw new Error('Claude not configured. Set ANTHROPIC_API_KEY in .env.local');
  }

  const documents = input.documents ?? [];
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        `Vertical name: ${input.name}`,
        `Vertical description: ${input.description}`,
        `Knowledge notes: ${input.knowledgeNotes.trim() || '(none provided)'}`,
        ...(documents.length > 0 ? ['', 'Reference documents:', buildDocumentsSection(documents)] : []),
        '',
        'Build the full call playbook for this vertical now.',
      ].join('\n'),
    },
  ];

  let lastError = 'unknown validation error';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await client.messages.create({
      model: PLAYBOOK_MODEL,
      // 4000 proved too small in the first live run: the tool input got cut
      // mid-JSON and a playbook with only icp+angles reached the database.
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      tools: [EMIT_PLAYBOOK_TOOL],
      tool_choice: { type: 'tool', name: 'emit_playbook' },
      messages,
    });

    // A response cut off by the token ceiling can carry a partial tool input
    // that still parses — reject it before it can reach the database.
    if (response.stop_reason === 'max_tokens') {
      throw new Error('Playbook generation ran past the token limit; nothing was saved. Try again.');
    }

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === 'emit_playbook',
    );
    if (!toolUse) {
      throw new Error('Claude did not return a playbook.');
    }

    const checked = validatePlaybook(normalizePlaybookInput(toolUse.input));
    if (checked.valid) {
      return checked.playbook;
    }
    lastError = checked.error;

    // Log a compact shape summary (keys and types only) so a schema drift is
    // diagnosable from the server log without dumping whole payloads.
    const raw = toolUse.input as Record<string, unknown>;
    const shape = Object.fromEntries(
      Object.entries(raw ?? {}).map(([k, v]) => [
        k,
        Array.isArray(v) ? `array(${v.length})[${typeof v[0]}]` : typeof v,
      ]),
    );
    console.error(`Invalid playbook shape from Claude (attempt ${attempt}):`, JSON.stringify(shape));

    if (attempt < MAX_ATTEMPTS) {
      // The API requires a tool_result for EVERY tool_use block in the
      // assistant turn (the model can emit more than one), so answer all.
      const allToolUses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      messages.push(
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content: allToolUses.map((block) => ({
            type: 'tool_result' as const,
            tool_use_id: block.id,
            is_error: true,
            content: `That playbook was rejected: ${checked.error} Call emit_playbook again with every field as real JSON of its declared type. Arrays must be JSON arrays, one element per item, no XML tags, no JSON-encoded strings. The angles and avoid fields must be arrays of plain strings, never objects.`,
          })),
        },
      );
    }
  }

  throw new Error(`Claude returned an incomplete playbook (${lastError}); nothing was saved.`);
}
