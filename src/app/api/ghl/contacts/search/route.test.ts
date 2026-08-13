import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveCurrentHubActor: vi.fn(),
  searchContacts: vi.fn(),
  insertAudit: vi.fn(),
}));

vi.mock('@/lib/auth/resource', () => ({ resolveCurrentHubActor: mocks.resolveCurrentHubActor }));
vi.mock('@/lib/ghl/client', () => ({
  HighLevelError: class HighLevelError extends Error {
    constructor(message: string, public status?: number) { super(message); }
  },
  isHighLevelConfigured: () => true,
  searchContacts: mocks.searchContacts,
}));
vi.mock('@/lib/supabase', () => ({
  getSupabaseServerClient: () => ({
    from: () => ({ insert: mocks.insertAudit }),
  }),
}));

import { GET } from './route';

const customer = {
  id: 'contact-1', fullName: 'Customer One', email: 'customer@example.com',
  phone: '+15551234567', address1: '1 Private Road', dnd: true, tags: ['private'],
};

describe('GET /api/ghl/contacts/search resource safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchContacts.mockResolvedValue([customer]);
    mocks.insertAudit.mockResolvedValue({ error: null });
  });

  it('returns only identity-safe results to an ordinary Office employee', async () => {
    mocks.resolveCurrentHubActor.mockResolvedValue({
      status: 'resolved',
      actor: { employeeId: 'employee-1', capabilities: ['office.customer.search'] },
    });

    const response = await GET(new Request('https://ops.example.com/api/ghl/contacts/search?q=Customer'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.contacts).toEqual([{
      id: 'contact-1', fullName: 'Customer One', email: null, phone: null, redacted: true,
    }]);
    expect(JSON.stringify(body)).not.toContain('Private Road');
    expect(mocks.insertAudit).not.toHaveBeenCalled();
  });

  it('audits Owner/Admin full-result access without logging the search query', async () => {
    mocks.resolveCurrentHubActor.mockResolvedValue({
      status: 'resolved',
      actor: { employeeId: 'admin-1', capabilities: ['office.customer.search', 'operations.admin'] },
    });

    const response = await GET(new Request('https://ops.example.com/api/ghl/contacts/search?q=private@example.com'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.contacts[0]).toMatchObject({
      email: 'customer@example.com', phone: '+15551234567', redacted: false,
    });
    expect(mocks.insertAudit).toHaveBeenCalledWith({
      kind: 'team_contact_search',
      detail: { actingEmployeeId: 'admin-1', resultCount: 1 },
    });
  });

  it('fails before searching when actor resolution fails', async () => {
    mocks.resolveCurrentHubActor.mockResolvedValue({ status: 'denied' });

    const response = await GET(new Request('https://ops.example.com/api/ghl/contacts/search?q=Customer'));

    expect(response.status).toBe(403);
    expect(mocks.searchContacts).not.toHaveBeenCalled();
  });

  it('does not log a customer search query when HighLevel fails', async () => {
    mocks.resolveCurrentHubActor.mockResolvedValue({
      status: 'resolved',
      actor: { employeeId: 'employee-1', capabilities: ['office.customer.search'] },
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.searchContacts.mockRejectedValue(new Error('path includes private@example.com'));

    const response = await GET(new Request('https://ops.example.com/api/ghl/contacts/search?q=private@example.com'));

    expect(response.status).toBe(500);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('private@example.com');
    errorSpy.mockRestore();
  });
});
