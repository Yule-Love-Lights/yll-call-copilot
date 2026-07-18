// Distills the operator's own "interview yourself" answers (the curated
// question bank in interview.ts) into structured brain_insights rows, one
// Claude call per completed interview. Same forced tool-use +
// normalize/validate/single-retry pattern as src/lib/transcripts/distill.ts
// and src/lib/analytics/brainReview.ts.

import Anthropic from '@anthropic-ai/sdk';
import { getClaudeClient } from '../claude';
import { INSIGHT_LENSES, isInsightLens, type InsightLens } from './types';

// Single exported const for the model id -- bump here, nowhere else, if the
// model ever changes. Sonnet: this runs once per finished interview (not
// per question), the same "once per click, quality over per-call cost"
// reasoning as DISTILL_MODEL in transcripts/distill.ts.
export const INTERVIEW_MODEL = 'claude-sonnet-5';

export type InterviewAnswer = {
  question: string;
  lens: InsightLens;
  answer: string;
};

export type DistilledInsight = {
  lens: InsightLens;
  title: string;
  content: string;
};

const SYSTEM_PROMPT = `You are helping the owner of Yule Love Lights, a residential and commercial lighting company, turn their own answers to a short self-interview into a handful of clear, reusable notes for their sales team's knowledge base.

You are given a list of question/answer pairs from the interview. Each question is already tagged with a lens: market, leads, coaching, or general.

For each question the owner actually answered (skip any left blank), write one structured insight: a short title (under 60 characters) and tightened content (2 to 4 sentences, plain English) that keeps every concrete detail and number the owner gave and never invents one that was not said. Keep the same lens the question was tagged with unless the answer clearly belongs to a different lens.

Never use an em dash. Never use the words "unlock", "leverage", or "delve".

In the emit_insights tool call, return one object per answered question. Do not merge two questions into one insight, and do not invent an insight for a question the owner left blank.`;

const EMIT_INSIGHTS_TOOL: Anthropic.Tool = {
  name: 'emit_insights',
  description: 'Return one structured insight per interview question the owner actually answered.',
  input_schema: {
    type: 'object',
    properties: {
      insights: {
        type: 'array',
        maxItems: 10,
        items: {
          type: 'object',
          properties: {
            lens: {
              type: 'string',
              enum: INSIGHT_LENSES,
              description: 'Which lens this insight belongs under.',
            },
            title: {
              type: 'string',
              description: 'Short title, under 60 characters.',
            },
            content: {
              type: 'string',
              description:
                'Tightened content, 2 to 4 sentences, plain English, keeping every concrete detail and number the owner gave.',
            },
          },
          required: ['lens', 'title', 'content'],
        },
        description: 'One insight per answered interview question.',
      },
    },
    required: ['insights'],
  },
};

export type InsightsValidationResult = { valid: true; insights: DistilledInsight[] } | { valid: false; error: string };

// Reads value.insights and validates/normalizes it, same shape as
// distill.ts's validateProposals: reject the whole batch on any malformed
// item rather than silently dropping it.
export function validateInsights(value: unknown): InsightsValidationResult {
  if (typeof value !== 'object' || value === null) {
    return { valid: false, error: 'Result must be an object.' };
  }
  const raw = (value as Record<string, unknown>).insights;
  if (!Array.isArray(raw)) {
    return { valid: false, error: 'insights must be an array.' };
  }

  const insights: DistilledInsight[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      return { valid: false, error: 'each insight must be an object.' };
    }
    const i = item as Record<string, unknown>;
    if (!isInsightLens(i.lens)) {
      return { valid: false, error: 'lens must be one of market|leads|coaching|general.' };
    }
    if (typeof i.title !== 'string' || !i.title.trim()) {
      return { valid: false, error: 'title must be a non-empty string.' };
    }
    if (typeof i.content !== 'string' || !i.content.trim()) {
      return { valid: false, error: 'content must be a non-empty string.' };
    }
    insights.push({ lens: i.lens, title: i.title.trim(), content: i.content.trim() });
  }

  return { valid: true, insights: insights.slice(0, 10) };
}

const MAX_ATTEMPTS = 2;
// A handful of short title+content pairs -- far smaller than the whole-
// playbook-section payloads distill.ts/brainReview.ts budget for, so a
// modest ceiling is plenty.
const MAX_TOKENS = 4000;

// Returns [] when every answer was left blank (nothing to distill) instead
// of making a Claude call for no reason.
export async function distillInterview(answers: InterviewAnswer[]): Promise<DistilledInsight[]> {
  const answered = answers.filter(a => a.answer.trim());
  if (answered.length === 0) return [];

  const client = getClaudeClient();
  if (!client) {
    throw new Error('Claude not configured. Set ANTHROPIC_API_KEY in .env.local');
  }

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        "Interview answers (question, tagged lens, the owner's answer):",
        JSON.stringify(answered, null, 2),
        '',
        'Distill these into structured insights now.',
      ].join('\n'),
    },
  ];

  let lastError = 'unknown validation error';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await client.messages.create({
      model: INTERVIEW_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [EMIT_INSIGHTS_TOOL],
      tool_choice: { type: 'tool', name: 'emit_insights' },
      messages,
    });

    if (response.stop_reason === 'max_tokens') {
      throw new Error('Interview distillation ran past the token limit; nothing was distilled.');
    }

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === 'emit_insights',
    );
    if (!toolUse) {
      throw new Error('Claude did not return insights.');
    }

    const checked = validateInsights(toolUse.input);
    if (checked.valid) {
      return checked.insights;
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
            content: `That result was rejected: ${checked.error} Call emit_insights again with a valid insights array.`,
          })),
        },
      );
    }
  }

  throw new Error(`Claude returned invalid insights (${lastError}); nothing was distilled.`);
}
