// Turns a vertical description into a full cold-call playbook using Claude's
// tool-use pattern to force structured output: one tool (emit_playbook) whose
// input_schema mirrors the Playbook type, with tool_choice forcing that tool
// so the response is always parseable — never free-text that needs scraping.

import Anthropic from '@anthropic-ai/sdk';
import { getClaudeClient } from '../claude';
import type { Playbook } from './types';

// Single exported const for the model id — bump here, nowhere else, if the
// model ever changes.
export const PLAYBOOK_MODEL = 'claude-sonnet-5';

const SYSTEM_PROMPT = `You are a veteran cold-calling coach for Yule Love Lights, a residential and commercial lighting company (holiday lighting, permanent exterior lighting, event lighting, and commercial lighting). You are writing a call playbook that a human rep will use on real phone calls to homeowners and local businesses.

Never use B2B-SaaS language ("solutions", "synergy", "stakeholders", "value prop", and similar). This is a lighting company talking to homeowners and business owners, not a software pitch.

Every script must be made of short sentences a rep can actually say out loud on a call. Prefer warm re-engagement of past customers over pressure tactics or urgency gimmicks.

Ground every part of the playbook in the vertical description and knowledge notes the user provides. Do not invent company facts that contradict what you are given.

Openers must include at least three variants: one labeled "Past customer", one labeled "Neighbor install", and at least one cold-call variant.

Objections must cover at least these five: price, "not interested", "email me info", talking to a spouse or other decision-maker, and bad timing.

The voicemail script must be short enough for a rep to speak in under 20 seconds.

Never use an em dash. Never use the words "unlock", "leverage", or "delve".`;

const EMIT_PLAYBOOK_TOOL: Anthropic.Tool = {
  name: 'emit_playbook',
  description: 'Return the completed cold-call playbook for this vertical as structured data.',
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
              description: 'Scenario label, e.g. "Past customer" or "Neighbor install".',
            },
            script: {
              type: 'string',
              description: 'The spoken opener, as short sentences a rep can say out loud.',
            },
          },
          required: ['label', 'script'],
        },
        description:
          'Opener scripts. Must include a "Past customer" variant, a "Neighbor install" variant, and at least one cold-call variant.',
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
};

export async function generatePlaybook(input: GeneratePlaybookInput): Promise<Playbook> {
  const client = getClaudeClient();
  if (!client) {
    throw new Error('Claude not configured. Set ANTHROPIC_API_KEY in .env.local');
  }

  const response = await client.messages.create({
    model: PLAYBOOK_MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    tools: [EMIT_PLAYBOOK_TOOL],
    tool_choice: { type: 'tool', name: 'emit_playbook' },
    messages: [
      {
        role: 'user',
        content: [
          `Vertical name: ${input.name}`,
          `Vertical description: ${input.description}`,
          `Knowledge notes: ${input.knowledgeNotes.trim() || '(none provided)'}`,
          '',
          'Build the full cold-call playbook for this vertical now.',
        ].join('\n'),
      },
    ],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === 'emit_playbook',
  );
  if (!toolUse) {
    throw new Error('Claude did not return a playbook.');
  }

  return toolUse.input as Playbook;
}
