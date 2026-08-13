import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  resolveCurrentHubActor: vi.fn(),
  sendConversationMessage: vi.fn(),
  getContact: vi.fn(),
  getOpportunitiesForContact: vi.fn(),
  getStageNameMap: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({
  getSupabaseServerClient: () => ({ rpc: mocks.rpc }),
  isSupabaseConfigured: () => true,
  isMissingTableError: () => false,
}));
vi.mock('@/lib/auth/resource', () => ({ resolveCurrentHubActor: mocks.resolveCurrentHubActor }));
vi.mock('@/lib/leads/followupSending', () => ({ isFollowupSendingActivated: () => true }));
vi.mock('@/lib/ghl/client', () => ({
  HighLevelError: class HighLevelError extends Error {
    constructor(message: string, public status?: number) {
      super(message);
    }
  },
  isHighLevelConfigured: () => true,
  sendConversationMessage: mocks.sendConversationMessage,
  getContact: mocks.getContact,
  getOpportunitiesForContact: mocks.getOpportunitiesForContact,
  getStageNameMap: mocks.getStageNameMap,
}));

import { POST } from './route';

const ID = '11111111-2222-4333-8444-555555555555';

describe('POST /api/followups/[id]/send safe ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GHL_FOLLOWUP_SEND_ENABLED = 'true';
    mocks.resolveCurrentHubActor.mockResolvedValue({
      status: 'resolved',
      actor: { employeeId: 'employee-1', email: 'rep@example.com' },
    });
    mocks.getContact.mockResolvedValue({
      id: 'ghl-1',
      email: 'customer@example.com',
      phone: '+15165551234',
      dnd: false,
      tags: [],
    });
    mocks.getOpportunitiesForContact.mockResolvedValue([]);
    mocks.getStageNameMap.mockResolvedValue(new Map());
    mocks.sendConversationMessage.mockResolvedValue({ messageId: 'message-1' });
  });
  afterEach(() => {
    delete process.env.GHL_FOLLOWUP_SEND_ENABLED;
  });

  it('does not let an admin send another employee draft', async () => {
    mocks.resolveCurrentHubActor.mockResolvedValue({
      status: 'resolved',
      actor: { employeeId: 'admin-1', email: 'admin@example.com' },
    });
    mocks.rpc.mockResolvedValue({ data: [{ result_code: 'not_owned_or_incomplete' }], error: null });
    const response = await POST(new Request(`https://ops.example.com/api/followups/${ID}`, { method: 'POST' }), {
      params: Promise.resolve({ id: ID }),
    });
    expect(response.status).toBe(403);
    expect(mocks.sendConversationMessage).not.toHaveBeenCalled();
  });

  it('blocks an uncertain earlier attempt instead of sending twice', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ result_code: 'send_unknown' }], error: null });
    const response = await POST(new Request(`https://ops.example.com/api/followups/${ID}`, { method: 'POST' }), {
      params: Promise.resolve({ id: ID }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reviewRequired: true });
    expect(mocks.sendConversationMessage).not.toHaveBeenCalled();
  });

  it('rechecks current customer permission after claiming and does not send an opted-out contact', async () => {
    // The route compares this to its generated attempt UUID. Return it from
    // the RPC mock rather than weakening the production equality check.
    mocks.rpc
      .mockImplementationOnce(async (_name, args) => ({
        data: [{
          result_code: 'ready',
          followup_id: ID,
          call_id: 'call-1',
          kind: 'sms',
          to_address: '+15165551234',
          body: 'Following up',
          ghl_contact_id: 'ghl-1',
          send_attempt_id: args.p_send_attempt_id,
        }],
        error: null,
      }))
      .mockResolvedValueOnce({ data: [{ result_code: 'finished' }], error: null });
    mocks.getContact.mockResolvedValue({
      id: 'ghl-1',
      phone: '+15165551234',
      dnd: false,
      dndSettings: { SMS: { status: 'active' } },
      tags: [],
    });

    const response = await POST(new Request(`https://ops.example.com/api/followups/${ID}`, { method: 'POST' }), {
      params: Promise.resolve({ id: ID }),
    });

    expect(response.status).toBe(409);
    expect(mocks.sendConversationMessage).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenLastCalledWith('finish_owned_followup_send', expect.objectContaining({
      p_result: 'definite_failure',
      p_provider_message_id: null,
    }));
  });

  it('persists the provider message id with a successful send', async () => {
    mocks.rpc
      .mockImplementationOnce(async (_name, args) => ({
        data: [{
          result_code: 'ready',
          followup_id: ID,
          call_id: 'call-1',
          kind: 'email',
          to_address: 'customer@example.com',
          subject: 'Hello',
          body: 'Following up',
          ghl_contact_id: 'ghl-1',
          send_attempt_id: args.p_send_attempt_id,
        }],
        error: null,
      }))
      .mockResolvedValueOnce({ data: [{ result_code: 'finished' }], error: null });

    const response = await POST(new Request(`https://ops.example.com/api/followups/${ID}`, { method: 'POST' }), {
      params: Promise.resolve({ id: ID }),
    });

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith('finish_owned_followup_send', expect.objectContaining({
      p_result: 'sent',
      p_provider_message_id: 'message-1',
    }));
  });

  it('marks a provider success without a message id uncertain instead of pretending it is finalized', async () => {
    mocks.rpc
      .mockImplementationOnce(async (_name, args) => ({
        data: [{
          result_code: 'ready',
          followup_id: ID,
          call_id: 'call-1',
          kind: 'sms',
          to_address: '+15165551234',
          body: 'Following up',
          ghl_contact_id: 'ghl-1',
          send_attempt_id: args.p_send_attempt_id,
        }],
        error: null,
      }))
      .mockResolvedValueOnce({ data: [{ result_code: 'finished' }], error: null });
    mocks.sendConversationMessage.mockResolvedValue({ messageId: null });

    const response = await POST(new Request(`https://ops.example.com/api/followups/${ID}`, { method: 'POST' }), {
      params: Promise.resolve({ id: ID }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ sent: true, reviewRequired: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith('finish_owned_followup_send', expect.objectContaining({
      p_result: 'unknown',
      p_provider_message_id: null,
    }));
  });
});
