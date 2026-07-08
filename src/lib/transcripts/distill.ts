// Distills the aggregated call-learnings for a vertical (see
// src/app/api/verticals/[id]/insights/route.ts) plus its active playbook
// into up to 10 human-approvable playbook edit proposals, using the same
// forced tool-use + normalize/validate/single-retry pattern as
// src/lib/playbook/generate.ts and src/lib/transcripts/extract.ts.

import Anthropic from '@anthropic-ai/sdk';
import { getClaudeClient } from '../claude';
import type { Playbook } from '../playbook/types';
import type { ProposalKind, ProposalSection } from './types';

// Single exported const for the model id — bump here, nowhere else, if the
// model ever changes. Sonnet, not Haiku: this runs once per "Propose
// playbook updates" click (not per transcript), and the synthesis quality
// matters more than the per-call cost that drove EXTRACT_MODEL to Haiku.
export const DISTILL_MODEL = 'claude-sonnet-5';

export type InsightsAggregate = {
  totalCalls: number;
  booked: number;
  notBooked: number;
  unknownOutcome: number;
  topObjections: { objection: string; count: number; pct: number }[];
  topQuestions: { question: string; count: number }[];
  topWhatWorked: { item: string; count: number }[];
  topWhatFailed: { item: string; count: number }[];
  samplePriceTalk: string[];
};

export type DistilledProposal = {
  section: ProposalSection;
  kind: ProposalKind;
  current_value: unknown;
  proposed_value: unknown;
  evidence: string;
};

const SECTIONS: ProposalSection[] = ['icp', 'angles', 'openers', 'objections', 'avoid', 'voicemail'];
const KINDS: ProposalKind[] = ['add', 'change', 'remove'];

const SYSTEM_PROMPT = `You are a sales enablement analyst for a residential and commercial lighting company, Yule Love Lights. You are given aggregated patterns mined from real sales calls for one line of business (objection frequency, common customer questions, what worked, what failed, price talk) plus that line's current call playbook.

Propose concrete, specific edits to the playbook that the aggregate data actually supports. Every proposal must cite real counts from the aggregate as its evidence, in the form "appeared in N of M calls" or similar. Do not propose a change the aggregate does not support, and do not invent an objection, angle, or phrase that is not in the aggregate.

Propose at most 10 changes. Each is one of: add (a new item for the section), change (an edit to an existing item — set current_value to the existing item), or remove (drop an existing item — set current_value to it and proposed_value to null).

Never use an em dash. Never use the words "unlock", "leverage", or "delve".

In the emit_proposals tool call, proposed_value must be real JSON of the shape the section expects (icp: a string; angles/avoid: a string; openers: an object with label and script; objections: an object with objection and response; voicemail: a string). Never JSON-encode a value as a string and never wrap it in XML tags.`;

const EMIT_PROPOSALS_TOOL: Anthropic.Tool = {
  name: 'emit_proposals',
  description: 'Return up to 10 proposed playbook edits, each backed by the aggregate data.',
  input_schema: {
    type: 'object',
    properties: {
      proposals: {
        type: 'array',
        maxItems: 10,
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
              description: 'Why this change is proposed, citing real counts from the aggregate, e.g. "appeared in 214 of 1890 calls".',
            },
          },
          required: ['section', 'kind', 'evidence'],
        },
        description: 'The proposed playbook edits.',
      },
    },
    required: ['proposals'],
  },
};

function isValidSection(v: unknown): v is ProposalSection {
  return typeof v === 'string' && (SECTIONS as string[]).includes(v);
}
function isValidKind(v: unknown): v is ProposalKind {
  return typeof v === 'string' && (KINDS as string[]).includes(v);
}

type ProposalsValidationResult = { valid: true; proposals: DistilledProposal[] } | { valid: false; error: string };

function validateProposals(value: unknown): ProposalsValidationResult {
  if (typeof value !== 'object' || value === null) {
    return { valid: false, error: 'Result must be an object.' };
  }
  const raw = (value as Record<string, unknown>).proposals;
  if (!Array.isArray(raw)) {
    return { valid: false, error: 'proposals must be an array.' };
  }

  const proposals: DistilledProposal[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      return { valid: false, error: 'each proposal must be an object.' };
    }
    const p = item as Record<string, unknown>;
    if (!isValidSection(p.section)) {
      return { valid: false, error: 'section must be one of icp|angles|openers|objections|avoid|voicemail.' };
    }
    if (!isValidKind(p.kind)) {
      return { valid: false, error: 'kind must be one of add|change|remove.' };
    }
    if (typeof p.evidence !== 'string' || !p.evidence.trim()) {
      return { valid: false, error: 'evidence must be a non-empty string.' };
    }
    proposals.push({
      section: p.section,
      kind: p.kind,
      current_value: p.current_value ?? null,
      proposed_value: p.proposed_value ?? null,
      evidence: p.evidence,
    });
  }

  return { valid: true, proposals: proposals.slice(0, 10) };
}

const MAX_ATTEMPTS = 2;
// A proposal list mirrors whole playbook sections (openers/objections
// arrays) as current/proposed_value, so this uses the same generous ceiling
// as the playbook generation call rather than the small extraction budget.
const MAX_TOKENS = 8000;

export async function distillProposals(input: {
  aggregate: InsightsAggregate;
  playbook: Playbook | null;
}): Promise<DistilledProposal[]> {
  const client = getClaudeClient();
  if (!client) {
    throw new Error('Claude not configured. Set ANTHROPIC_API_KEY in .env.local');
  }

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        'Aggregate call data for this vertical:',
        JSON.stringify(input.aggregate, null, 2),
        '',
        'Current active playbook:',
        input.playbook ? JSON.stringify(input.playbook, null, 2) : '(no active playbook yet)',
        '',
        'Propose up to 10 playbook edits now, each backed by the aggregate data above.',
      ].join('\n'),
    },
  ];

  let lastError = 'unknown validation error';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await client.messages.create({
      model: DISTILL_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [EMIT_PROPOSALS_TOOL],
      tool_choice: { type: 'tool', name: 'emit_proposals' },
      messages,
    });

    if (response.stop_reason === 'max_tokens') {
      throw new Error('Proposal distillation ran past the token limit; nothing was saved.');
    }

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === 'emit_proposals',
    );
    if (!toolUse) {
      throw new Error('Claude did not return proposals.');
    }

    const checked = validateProposals(toolUse.input);
    if (checked.valid) {
      return checked.proposals;
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
            content: `That result was rejected: ${checked.error} Call emit_proposals again with a valid proposals array.`,
          })),
        },
      );
    }
  }

  throw new Error(`Claude returned invalid proposals (${lastError}); nothing was saved.`);
}
