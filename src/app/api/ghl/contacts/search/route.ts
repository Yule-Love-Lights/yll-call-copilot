// GET /api/ghl/contacts/search?q=... — server-side proxy for the GHL contact
// search so the API key never reaches the browser. Returns the redacted
// CrmContact shape only.

import { NextResponse } from 'next/server';
import { HighLevelError, isHighLevelConfigured, searchContacts } from '@/lib/ghl/client';

export async function GET(request: Request) {
  // Not configured is an expected state in Phase 0 — answer 200 with a flag
  // so the UI can show a friendly banner instead of an error.
  if (!isHighLevelConfigured()) {
    return NextResponse.json({ configured: false, contacts: [] });
  }

  const q = new URL(request.url).searchParams.get('q') ?? '';
  try {
    const contacts = await searchContacts(q);
    return NextResponse.json({ configured: true, contacts });
  } catch (err) {
    // Keep the upstream error body server-side; the browser gets a generic
    // message. Details land in the server log for debugging.
    console.error('GHL contact search failed:', err);
    const status = err instanceof HighLevelError && err.status ? 502 : 500;
    return NextResponse.json(
      { configured: true, contacts: [], error: 'HighLevel search failed' },
      { status },
    );
  }
}
