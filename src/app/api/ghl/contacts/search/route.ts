// GET /api/ghl/contacts/search?q=... — server-side proxy for the GHL contact
// search so the API key never reaches the browser. Returns the redacted
// CrmContact shape only.

import { NextResponse } from 'next/server';
import { hasCapability } from '@/lib/auth/capabilities';
import { resolveCurrentHubActor } from '@/lib/auth/resource';
import { HighLevelError, isHighLevelConfigured, searchContacts } from '@/lib/ghl/client';
import { getSupabaseServerClient } from '@/lib/supabase';

export async function GET(request: Request) {
  // Not configured is an expected state in Phase 0 — answer 200 with a flag
  // so the UI can show a friendly banner instead of an error.
  if (!isHighLevelConfigured()) {
    return NextResponse.json({ configured: false, contacts: [] });
  }

  const actorResolution = await resolveCurrentHubActor();
  if (actorResolution.status !== 'resolved') {
    return NextResponse.json(
      { configured: true, contacts: [], error: 'Access denied.' },
      { status: actorResolution.status === 'unavailable' ? 503 : 403 },
    );
  }
  const actor = actorResolution.actor;
  const canReadTeamContacts = hasCapability(actor, 'operations.admin');

  const q = new URL(request.url).searchParams.get('q') ?? '';
  try {
    const contacts = await searchContacts(q);
    if (canReadTeamContacts) {
      // Naldo/Jason team-wide contact searches are permitted but audited.
      // The raw query is deliberately not logged because it may itself be PII.
      const { error: auditError } = await getSupabaseServerClient()!
        .from('events_log')
        .insert({
          kind: 'team_contact_search',
          detail: { actingEmployeeId: actor.employeeId, resultCount: contacts.length },
        });
      if (auditError) {
        console.error('Audit team contact search failed:', auditError);
        return NextResponse.json(
          { configured: true, contacts: [], error: 'Could not audit this search.' },
          { status: 503 },
        );
      }
    }
    return NextResponse.json({
      configured: true,
      contacts: contacts.map(contact => ({
        id: contact.id,
        fullName: contact.fullName ?? null,
        email: canReadTeamContacts ? (contact.email ?? null) : null,
        phone: canReadTeamContacts ? (contact.phone ?? null) : null,
        redacted: !canReadTeamContacts,
      })),
    });
  } catch (err) {
    // The query may be a customer phone, email, or name. HighLevelError can
    // include the request path, so log only a safe status and never the error
    // object/message/body for this endpoint.
    const status = err instanceof HighLevelError && err.status ? 502 : 500;
    console.error('GHL contact search failed', {
      upstreamStatus: err instanceof HighLevelError ? (err.status ?? null) : null,
    });
    return NextResponse.json(
      { configured: true, contacts: [], error: 'HighLevel search failed' },
      { status },
    );
  }
}
