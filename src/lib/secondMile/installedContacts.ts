// Resolves the "installed/won this season" contact set that feeds the
// cookies+ornament run, the reveal-photo prompt, and the cold-snap
// check-in (AGENTS spec points 3b/3c/4). Primary source: GHL opportunities
// sitting in a won stage (src/lib/ghl/secondMile.ts's getWonOpportunities).
// Fallback, used only when HighLevel isn't configured or the GHL call
// itself fails: distinct ghl_contact_id on transcripts with outcome
// 'booked' this season, per the deviation noted in the PR -- addresses are
// never known from transcripts alone, so reveal-photo/crew messages degrade
// to "at tonight's install" for that source (see drafts.ts).

import type { SupabaseClient } from '@supabase/supabase-js';
import { getContact, isHighLevelConfigured } from '../ghl/client';
import { getWonOpportunities } from '../ghl/secondMile';
import { delay, GHL_RATE_LIMIT_GAP_MS } from '../transcripts/ingest';
import type { WonJobContact } from './types';

export type InstalledContactsSource = 'ghl_won_opportunity' | 'transcript_fallback';

export type InstalledContactsResult = {
  contacts: WonJobContact[];
  source: InstalledContactsSource;
};

// Hydrates each won opportunity's contact for name + street address -- the
// opportunity's embedded contact ref never carries an address (see
// HighLevelOpportunity's comment in ghl/types.ts). Sequential with the same
// rate-limit gap the queue builder uses (src/lib/leads/queue.ts): this runs
// once per distinct contact per cron tick, not per candidate row.
async function hydrateWonContacts(opportunities: { contactId: string }[]): Promise<WonJobContact[]> {
  const seen = new Set<string>();
  const contacts: WonJobContact[] = [];
  for (const opp of opportunities) {
    if (seen.has(opp.contactId)) continue;
    seen.add(opp.contactId);
    try {
      const hydrated = await getContact(opp.contactId);
      contacts.push({
        ghlContactId: hydrated.id,
        customerName: hydrated.fullName ?? null,
        address: hydrated.address1 ?? null,
      });
    } catch (err) {
      console.error(`Could not hydrate won-opportunity contact ${opp.contactId}:`, err);
    }
    await delay(GHL_RATE_LIMIT_GAP_MS);
  }
  return contacts;
}

async function transcriptFallback(supabase: SupabaseClient, seasonYear: number): Promise<WonJobContact[]> {
  const { data, error } = await supabase
    .from('transcripts')
    .select('ghl_contact_id, customer_name, called_at, created_at')
    .eq('outcome', 'booked');
  if (error) {
    console.error('Transcript fallback for installed contacts failed:', error);
    return [];
  }

  const byContact = new Map<string, WonJobContact>();
  for (const row of (data ?? []) as { ghl_contact_id: string | null; customer_name: string | null; called_at: string | null; created_at: string | null }[]) {
    if (!row.ghl_contact_id) continue;
    const when = row.called_at ?? row.created_at;
    if (when && new Date(when).getFullYear() !== seasonYear) continue;
    if (!byContact.has(row.ghl_contact_id)) {
      byContact.set(row.ghl_contact_id, { ghlContactId: row.ghl_contact_id, customerName: row.customer_name, address: null });
    }
  }
  return [...byContact.values()];
}

export async function getInstalledWonContacts(supabase: SupabaseClient, seasonYear: number): Promise<InstalledContactsResult> {
  if (isHighLevelConfigured()) {
    try {
      const opportunities = await getWonOpportunities();
      const contacts = await hydrateWonContacts(opportunities);
      return { contacts, source: 'ghl_won_opportunity' };
    } catch (err) {
      console.error('GHL won-opportunity lookup failed, falling back to transcript outcomes:', err);
    }
  }
  const contacts = await transcriptFallback(supabase, seasonYear);
  return { contacts, source: 'transcript_fallback' };
}
