// The AI-played homeowner for /practice: Claude plays the customer in
// character, one turn at a time, so a rep can rehearse a call before it
// counts for real. Scoring the finished transcript reuses the exact same
// engine every real call gets (src/lib/scoring/score.ts) -- this file only
// builds the customer's system prompt and drives the per-turn Claude call.
//
// PRACTICE_MODEL is pinned separately from SCORE_MODEL (scoring/score.ts) --
// same "one const, bump here only" convention -- even though both currently
// point at claude-sonnet-5, so a future change to one never silently drags
// the other along.

import Anthropic from '@anthropic-ai/sdk';
import { getClaudeClient } from '../claude';
import type { Playbook } from '../playbook/types';
import type { OfferElement } from '../scoring/types';
import type { PracticeEmotionalState, PracticeTurn } from './types';

export const PRACTICE_MODEL = 'claude-sonnet-5';

export type EmotionalState = PracticeEmotionalState;

// Persona flavor per state, written to match the language of the rubric's
// own master instruction (src/lib/scoring/rubric.ts's SEEDED_RUBRIC.master):
// excited wants the vision, busy wants it handled for them, guarded wants
// proof, status wants to keep up with (or beat) the neighbors. The customer
// the rep practices on behaves the same way that instruction describes, so
// naming the state back and running the matching track actually lands.
const STATE_PERSONAS: Record<EmotionalState, string> = {
  excited:
    "You are genuinely excited about the idea of lights on your home. You light up talking about how it could look, you ask visual questions (\"could we do icicle lights along the whole roofline?\"), and you warm quickly to a rep who paints the picture with you. You are an easy yes once you can see it.",
  busy:
    'You are slammed today -- work, kids, a dozen other things -- and you want this handled with the least effort from you. You are short and a little impatient, you ask things like "can you just handle it" and "what do you actually need from me," and you tune out anyone who makes this sound complicated or asks you to do homework.',
  guarded:
    'You have been burned before (a contractor ghosted, a neighbor got a bad install) and you are skeptical by default. You ask pointed questions about guarantees, what happens if something breaks, and whether this company actually stands behind its work. You only warm up once you hear real proof -- specifics, not vague reassurance.',
  status:
    'You care about how your home compares to the neighbors and want to be the best-looking house on the block. You mention what other houses on your street have, you want the best-looking option, and you respond well to a rep who matches your ambition instead of talking you down to something modest.',
};

export type BuildCustomerSystemPromptInput = {
  playbook: Playbook | null;
  emotionalState: EmotionalState;
  // The one objection the rep wants to drill this run (e.g. "the price is
  // too high," "I need to talk to my spouse") -- null/omitted means play the
  // state naturally without forcing a specific objection.
  objective?: string | null;
  offer: OfferElement[];
};

export function buildCustomerSystemPrompt(input: BuildCustomerSystemPromptInput): string {
  const persona = STATE_PERSONAS[input.emotionalState];

  const playbookLines: string[] = [];
  if (input.playbook) {
    if (input.playbook.icp) playbookLines.push(`For reference, the rep is trained to expect a customer like: ${input.playbook.icp}`);
    if (input.playbook.objections.length > 0) {
      playbookLines.push(
        `Objections real customers like you sometimes raise: ${input.playbook.objections.map(o => o.objection).join('; ')}`,
      );
    }
  }

  const offerLines = input.offer.map(o => `- ${o.name}: "${o.customer_line}"`);

  const objectiveLine = input.objective
    ? `Somewhere natural in the call, raise this exact objection or hesitation in your own words: "${input.objective}." Do not blurt it out first thing -- let it come up the way a real customer would.`
    : "Play the state naturally. You don't have to raise a specific objection -- react honestly to whatever the rep says.";

  return [
    'You are a homeowner on a phone call with a sales rep from Yule Love Lights, a residential lighting company. You are NOT an AI assistant right now -- you are playing a real customer character for a rep\'s practice roleplay. Never break character, never mention that you are an AI, a language model, or a practice exercise, and never offer meta-commentary on the rep\'s technique.',
    '',
    `Your emotional state this call: ${persona}`,
    '',
    objectiveLine,
    ...(playbookLines.length > 0 ? ['', ...playbookLines] : []),
    ...(offerLines.length > 0
      ? [
          '',
          'Offers this company sometimes makes -- react realistically if the rep brings one up (curious, skeptical, or reassured depending on your state), never just agreeing automatically:',
          ...offerLines,
        ]
      : []),
    '',
    'Speak like a real person on the phone: 1 to 3 short sentences per turn, plain everyday language, no bullet points, no stage directions, no headers.',
    'If the call reaches a natural resolution (you decide to book, decide not to, or need to go), end your line the way a real person hangs up -- "okay, let\'s do it," "I need to think about it, thanks," "I have to run" -- never announce that the call or the exercise is over.',
    'Never use an em dash. Never use the words "unlock", "leverage", or "delve".',
  ].join('\n');
}

function turnsToMessages(turns: Pick<PracticeTurn, 'speaker' | 'text'>[]): Anthropic.MessageParam[] {
  return turns.map(turn => ({
    role: turn.speaker === 'rep' ? 'user' : 'assistant',
    content: turn.text,
  }));
}

const MAX_TOKENS = 400;

async function callCustomer(messages: Anthropic.MessageParam[], systemPrompt: string): Promise<string> {
  const client = getClaudeClient();
  if (!client) {
    throw new Error('Claude not configured. Set ANTHROPIC_API_KEY in .env.local');
  }

  const response = await client.messages.create({
    model: PRACTICE_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages,
  });

  const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === 'text');
  if (!textBlock || !textBlock.text.trim()) {
    throw new Error('The practice customer did not return a line.');
  }
  return textBlock.text.trim();
}

// The very first line of the call -- the phone just connected and the
// "customer" (Claude) picks up and says hello in character. The bracketed
// stage direction below is never stored as a real turn; it only exists to
// elicit the opening line from an otherwise-empty message history.
export async function customerOpening(systemPrompt: string): Promise<string> {
  return callCustomer(
    [{ role: 'user', content: '[The phone just connected. Answer as the homeowner picking up the phone -- a short, natural greeting.]' }],
    systemPrompt,
  );
}

// The next homeowner line, given the full turn history so far (ending with
// the rep's latest line). Rep turns map to the user role, customer turns to
// the assistant role, so Claude is continuing its own prior lines in
// character rather than being re-told what it already said.
export async function customerReply(history: Pick<PracticeTurn, 'speaker' | 'text'>[], systemPrompt: string): Promise<string> {
  return callCustomer(turnsToMessages(history), systemPrompt);
}
