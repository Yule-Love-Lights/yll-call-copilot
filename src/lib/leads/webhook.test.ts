// Coverage for mapGhlWebhookPayload across the shapes the brief calls out
// (InboundMessage, call-type) plus the "tolerate missing fields" mandate —
// GHL webhook shapes vary and have never been verified live.

import { describe, it, expect } from 'vitest';
import { mapGhlWebhookPayload } from './webhook';

describe('mapGhlWebhookPayload', () => {
  it('recognizes an InboundMessage/SMS payload with flat contact fields', () => {
    const result = mapGhlWebhookPayload({
      type: 'InboundMessage',
      contactId: 'c1',
      phone: '5551234567',
      messageType: 'SMS',
      contactName: 'Jordan Rivera',
    });
    expect(result).toEqual({ recognized: true, channel: 'sms', contactId: 'c1', phone: '5551234567', name: 'Jordan Rivera' });
  });

  it('recognizes a call-type payload with a nested contact object', () => {
    const result = mapGhlWebhookPayload({
      type: 'InboundCall',
      contact: { id: 'c2', phone: '5559998888', firstName: 'Alex', lastName: 'Nguyen' },
    });
    expect(result).toEqual({ recognized: true, channel: 'call', contactId: 'c2', phone: '5559998888', name: 'Alex Nguyen' });
  });

  it('recognizes an InboundMessage whose messageType is Call', () => {
    const result = mapGhlWebhookPayload({ type: 'InboundMessage', contactId: 'c3', messageType: 'Call' });
    expect(result.recognized).toBe(true);
    expect(result.channel).toBe('call');
  });

  it('does not recognize an inbound email (not a call-console concern)', () => {
    const result = mapGhlWebhookPayload({ type: 'InboundMessage', contactId: 'c4', messageType: 'Email' });
    expect(result.recognized).toBe(false);
    expect(result.channel).toBe('unknown');
  });

  it('does not recognize an outbound message', () => {
    const result = mapGhlWebhookPayload({ type: 'OutboundMessage', contactId: 'c5', messageType: 'SMS' });
    expect(result.recognized).toBe(false);
  });

  it('does not recognize a payload with no identifiable contact', () => {
    const result = mapGhlWebhookPayload({ type: 'InboundMessage', messageType: 'SMS' });
    expect(result.recognized).toBe(false);
    expect(result.contactId).toBeNull();
  });

  it('falls back to an `event` field when `type` is absent', () => {
    const result = mapGhlWebhookPayload({ event: 'InboundCall', contactId: 'c6' });
    expect(result.recognized).toBe(true);
    expect(result.channel).toBe('call');
  });

  it('tolerates a non-object payload without throwing', () => {
    expect(mapGhlWebhookPayload(null)).toEqual({ recognized: false, channel: 'unknown', contactId: null, phone: null, name: null });
    expect(mapGhlWebhookPayload('a string')).toEqual({ recognized: false, channel: 'unknown', contactId: null, phone: null, name: null });
    expect(mapGhlWebhookPayload(undefined)).toEqual({ recognized: false, channel: 'unknown', contactId: null, phone: null, name: null });
  });

  it('tolerates an unrecognized event type without throwing', () => {
    const result = mapGhlWebhookPayload({ type: 'ContactTagUpdate', contactId: 'c7' });
    expect(result.recognized).toBe(false);
  });
});
