// Shared types for the GoHighLevel (GHL) contact lookup. Ported from the AI
// Quote Tool's integration layer (src/lib/integrations/types.ts), trimmed to
// only what Phase 0 needs: contact search + contact fetch by id.
// Opportunities, conversations, and Home.works types are dropped here — not
// used yet.
//
// Design note: we map HighLevel's contact shape into our own "CrmContact"
// shape before letting the rest of the app see it, so HighLevel-specific
// field names never leak into the UI.

// ─── Unified contact shape ────────────────────────────────────────────────
// This is what the rest of the app sees after a HighLevel lookup. Everything
// optional so a partial match still produces a useful result.
export type CrmContact = {
  id: string;                // canonical id from the source CRM
  source: 'highlevel';       // discriminator for future multi-CRM support
  firstName?: string;
  lastName?: string;
  fullName?: string;         // HighLevel sends both halves + a combined — we store all
  email?: string;
  phone?: string;
  address1?: string;         // street line
  city?: string;
  state?: string;
  postalCode?: string;
};

// ─── HighLevel API shape (subset) ─────────────────────────────────────────
// Only the fields we actually consume. HighLevel's response is much larger;
// we defensively typecast rather than depending on their full schema.
export type HighLevelContact = {
  id: string;
  locationId?: string;
  firstName?: string;
  lastName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  customFields?: Array<{ id: string; value?: string }>;
  tags?: string[];
  // GHL's do-not-disturb flag — the queue builder must never queue a contact
  // with dnd true.
  dnd?: boolean;
  // Phase 2 lead queue (src/lib/leads/queue.ts) needs recency to find fresh
  // inbound inquiries. Field names verified against a LIVE contact payload
  // on 2026-07-08 (dateAdded, dateUpdated, tags, dnd all present).
  dateAdded?: string;
  dateUpdated?: string;
};

// ─── Opportunity shape (subset) ────────────────────────────────────────────
// Ported from the AI Quote Tool's integration layer, trimmed to what the
// Phase 1.5 transcript outcome matcher needs: which pipeline stage a
// contact's opportunity currently sits in.
export type HighLevelOpportunity = {
  id: string;
  name?: string;
  contactId: string;
  pipelineId: string;
  pipelineStageId?: string;
  status?: 'open' | 'won' | 'lost' | 'abandoned';
  monetaryValue?: number;
  // Phase 2 lead queue needs opportunity age ("quote sent N days ago") and a
  // shortcut to contact details so scoring a batch of opportunities doesn't
  // require one getContact() round trip per row. Best-effort field names,
  // same caveat as HighLevelContact's date fields above — the opportunities
  // search response often embeds a lightweight contact ref, but the exact
  // shape has not been verified against a live payload.
  createdAt?: string;
  updatedAt?: string;
  contact?: { id: string; name?: string; email?: string; phone?: string };
};
