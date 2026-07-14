// Coverage for mapGhlInboundEmailPayload -- the email-specific sibling of
// src/lib/leads/webhook.ts's mapGhlWebhookPayload. That mapper deliberately
// excludes email (it feeds the call-console screen-pop, and an inbound email
// popping a card for every rep would be noisy); this one exists precisely to
// recognize the same payload shape for the email-drafting pipeline instead.
// GHL webhook shapes vary and have never been verified live, so this
// tolerates missing fields the same way the call/SMS mapper does.

import { describe, it, expect } from 'vitest';
import { mapGhlInboundEmailPayload } from './webhook';

describe('mapGhlInboundEmailPayload', () => {
  it('recognizes an inbound email with flat fields', () => {
    const result = mapGhlInboundEmailPayload({
      type: 'InboundMessage',
      messageType: 'Email',
      contactId: 'c1',
      conversationId: 'convo1',
      messageId: 'msg1',
      subject: 'Question about pricing',
      body: 'How much for a two story colonial?',
      from: 'jordan@example.com',
      contactName: 'Jordan Rivera',
      dateAdded: '2026-07-14T10:00:00Z',
    });
    expect(result).toEqual({
      recognized: true,
      sourceMessageId: 'msg1',
      contactId: 'c1',
      conversationId: 'convo1',
      fromAddress: 'jordan@example.com',
      fromName: 'Jordan Rivera',
      subject: 'Question about pricing',
      body: 'How much for a two story colonial?',
      receivedAt: '2026-07-14T10:00:00Z',
    });
  });

  it('recognizes an inbound email with nested contact/message objects', () => {
    const result = mapGhlInboundEmailPayload({
      type: 'ConversationMessage',
      contact: { id: 'c2', email: 'alex@example.com', firstName: 'Alex', lastName: 'Nguyen' },
      message: { type: 'Email', body: 'Do you service my zip code?', subject: 're: quote', id: 'msg2' },
    });
    expect(result.recognized).toBe(true);
    expect(result.contactId).toBe('c2');
    expect(result.fromAddress).toBe('alex@example.com');
    expect(result.fromName).toBe('Alex Nguyen');
    expect(result.body).toBe('Do you service my zip code?');
    expect(result.sourceMessageId).toBe('msg2');
  });

  it('does not recognize an SMS/call payload (messageType has no email)', () => {
    const result = mapGhlInboundEmailPayload({ type: 'InboundMessage', contactId: 'c3', messageType: 'SMS', body: 'call me' });
    expect(result.recognized).toBe(false);
  });

  it('does not recognize an outbound email (a reply we sent, not a customer reply)', () => {
    const result = mapGhlInboundEmailPayload({
      type: 'InboundMessage',
      direction: 'outbound',
      messageType: 'Email',
      contactId: 'c4',
      body: 'Thanks for calling!',
    });
    expect(result.recognized).toBe(false);
  });

  it('does not recognize an email payload with no body (nothing to draft against)', () => {
    const result = mapGhlInboundEmailPayload({ type: 'InboundMessage', messageType: 'Email', contactId: 'c5' });
    expect(result.recognized).toBe(false);
  });

  it('does not recognize a payload with no identifiable contact', () => {
    const result = mapGhlInboundEmailPayload({ type: 'InboundMessage', messageType: 'Email', body: 'hi' });
    expect(result.recognized).toBe(false);
    expect(result.contactId).toBeNull();
  });

  it('tolerates a non-object payload without throwing', () => {
    const empty = { recognized: false, sourceMessageId: null, contactId: null, conversationId: null, fromAddress: null, fromName: null, subject: null, body: null, receivedAt: null };
    expect(mapGhlInboundEmailPayload(null)).toEqual(empty);
    expect(mapGhlInboundEmailPayload('a string')).toEqual(empty);
    expect(mapGhlInboundEmailPayload(undefined)).toEqual(empty);
  });

  it('tolerates an unrecognized event type without throwing', () => {
    const result = mapGhlInboundEmailPayload({ type: 'ContactTagUpdate', contactId: 'c6' });
    expect(result.recognized).toBe(false);
  });
});
