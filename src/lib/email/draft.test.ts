// Coverage for src/lib/email/draft.ts: the intent-pivot rules baked into the
// system prompt, the detectVerticalSlug best-guess, the emit_email_reply
// validator, and generateEmailReply's happy/retry/error paths -- same
// mocking style as src/lib/leads/followups.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const createMock = vi.fn();
const getClaudeClientMock = vi.fn();

vi.mock('../claude', () => ({
  getClaudeClient: () => getClaudeClientMock(),
}));

import {
  EMAIL_REPLY_MODEL,
  EMAIL_REPLY_SYSTEM_PROMPT,
  DEFAULT_GUARANTEES,
  detectVerticalSlug,
  validateEmailReply,
  generateEmailReply,
} from './draft';

describe('EMAIL_REPLY_SYSTEM_PROMPT', () => {
  it('is grounded in the customer-facing writing tier', () => {
    expect(EMAIL_REPLY_MODEL).toBe('claude-sonnet-5');
  });

  it('never forces a call on a buyer/question intent -- the customer chose email on purpose', () => {
    expect(EMAIL_REPLY_SYSTEM_PROMPT).toMatch(/never force a call/i);
  });

  it('requires exactly one guarantee woven in', () => {
    expect(EMAIL_REPLY_SYSTEM_PROMPT).toMatch(/exactly one guarantee/i);
  });

  it('bans the AI writing tells (voice rules)', () => {
    expect(EMAIL_REPLY_SYSTEM_PROMPT).toMatch(/em dash/i);
    expect(EMAIL_REPLY_SYSTEM_PROMPT.toLowerCase()).toContain('unlock');
    expect(EMAIL_REPLY_SYSTEM_PROMPT.toLowerCase()).toContain('leverage');
    expect(EMAIL_REPLY_SYSTEM_PROMPT.toLowerCase()).toContain('delve');
  });
});

describe('detectVerticalSlug', () => {
  it('defaults to holiday when nothing else matches', () => {
    expect(detectVerticalSlug('Question', 'Do you have availability this week?')).toBe('holiday');
  });

  it('detects permanent from the subject', () => {
    expect(detectVerticalSlug('Permanent lighting quote', 'Just curious about pricing.')).toBe('permanent');
  });

  it('detects event from the body', () => {
    expect(detectVerticalSlug('Quick question', 'We are planning an event lighting setup for a wedding.')).toBe('event');
  });

  it('tolerates null subject', () => {
    expect(detectVerticalSlug(null, 'permanent track lighting please')).toBe('permanent');
  });
});

describe('validateEmailReply', () => {
  const good = { intent: 'buyer', subject: 'Re: your quote', body: 'Thanks so much for reaching out!', guarantee_used: 'fast_fix_48h' };

  it('accepts a well-formed reply', () => {
    const result = validateEmailReply(good);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.reply).toEqual(good);
  });

  it('rejects an invalid intent', () => {
    const result = validateEmailReply({ ...good, intent: 'angry' });
    expect(result.valid).toBe(false);
  });

  it('rejects a missing subject', () => {
    const result = validateEmailReply({ intent: 'buyer', body: 'hi', guarantee_used: 'x' });
    expect(result.valid).toBe(false);
  });

  it('rejects an empty body', () => {
    const result = validateEmailReply({ ...good, body: '   ' });
    expect(result.valid).toBe(false);
  });

  it('rejects a missing guarantee_used', () => {
    const result = validateEmailReply({ intent: 'buyer', subject: 'x', body: 'y' });
    expect(result.valid).toBe(false);
  });

  it('rejects a non-object value', () => {
    expect(validateEmailReply(null).valid).toBe(false);
    expect(validateEmailReply('nope').valid).toBe(false);
  });
});

describe('generateEmailReply', () => {
  const sampleReply = {
    intent: 'question',
    subject: 'Re: service area',
    body: 'Yes, we cover your zip code! Let us know if you have any other questions.',
    guarantee_used: 'all_inclusive',
  };

  beforeEach(() => {
    createMock.mockReset();
    getClaudeClientMock.mockReset();
    getClaudeClientMock.mockReturnValue({ messages: { create: createMock } });
  });

  it('parses the emit_email_reply tool_use block', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_email_reply', input: sampleReply }],
      stop_reason: 'tool_use',
    });

    const result = await generateEmailReply({
      fromName: 'Jordan Rivera',
      subject: 'Do you service my area?',
      body: 'Just wondering if you cover my zip code.',
      verticalName: 'Holiday Lighting',
      playbook: null,
      guarantees: DEFAULT_GUARANTEES,
    });

    expect(result).toEqual(sampleReply);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0].model).toBe(EMAIL_REPLY_MODEL);
    expect(createMock.mock.calls[0][0].tool_choice).toEqual({ type: 'tool', name: 'emit_email_reply' });
  });

  it('throws when Claude is not configured', async () => {
    getClaudeClientMock.mockReturnValue(null);
    await expect(
      generateEmailReply({ fromName: null, subject: null, body: 'hi', verticalName: null, playbook: null, guarantees: DEFAULT_GUARANTEES }),
    ).rejects.toThrow(/not configured/i);
  });

  it('retries once on an invalid intent and succeeds on the second attempt', async () => {
    createMock
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_email_reply', input: { ...sampleReply, intent: 'angry' } }],
        stop_reason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'toolu_2', name: 'emit_email_reply', input: sampleReply }],
        stop_reason: 'tool_use',
      });

    const result = await generateEmailReply({
      fromName: null,
      subject: null,
      body: 'hi',
      verticalName: null,
      playbook: null,
      guarantees: DEFAULT_GUARANTEES,
    });

    expect(result).toEqual(sampleReply);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('throws after the retry is also invalid', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_email_reply', input: { subject: '', body: '', guarantee_used: '' } }],
      stop_reason: 'tool_use',
    });

    await expect(
      generateEmailReply({ fromName: null, subject: null, body: 'hi', verticalName: null, playbook: null, guarantees: DEFAULT_GUARANTEES }),
    ).rejects.toThrow(/invalid/i);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('throws when the response was cut off by the token limit', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_email_reply', input: sampleReply }],
      stop_reason: 'max_tokens',
    });

    await expect(
      generateEmailReply({ fromName: null, subject: null, body: 'hi', verticalName: null, playbook: null, guarantees: DEFAULT_GUARANTEES }),
    ).rejects.toThrow(/token limit/i);
  });
});
