-- RLS: service-role only, same convention as 0001-0006.
-- Workstream 6 schema: fast on-brand email replies. An inbound customer
-- email (via GHL's conversations webhook, path A, or the /api/inbox/check
-- fallback poll + future Gmail adapter, path B) is stored in inbound_emails,
-- then instantly drafted into email_reply_drafts by Claude -- drafting is
-- automatic, sending is always a human click gated by GHL_SEND_ENABLED (see
-- POST /api/inbox/[draftId]/send), same split as the existing followups
-- table's draft -> approved_sent lifecycle (0004_calls.sql).
-- File only -- not applied anywhere yet, same convention as 0001-0006.

create table inbound_emails (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('ghl', 'gmail')),
  -- The source system's own message id, used to make ingestion idempotent --
  -- a webhook retry or a /api/inbox/check poll re-seeing the same message
  -- must never insert a second row (see src/lib/email/ingest.ts).
  source_message_id text unique,
  ghl_contact_id text,
  ghl_conversation_id text,
  from_address text,
  from_name text,
  subject text,
  body text not null,
  received_at timestamptz,
  intent text check (intent in ('buyer', 'question', 'service', 'other')),
  status text not null default 'new' check (status in ('new', 'drafted', 'sent', 'dismissed')),
  created_at timestamptz default now()
);

create table email_reply_drafts (
  id uuid primary key default gen_random_uuid(),
  inbound_email_id uuid not null references inbound_emails(id) on delete cascade,
  subject text not null,
  body text not null,
  intent text,
  -- Which guarantee (offer_versions element key, or a DEFAULT_GUARANTEES key
  -- when that table isn't populated yet -- see src/lib/email/draft.ts) the
  -- draft wove in. Free text, not a foreign key: offer_versions ships in a
  -- sibling migration and its element keys are not enumerable here.
  guarantee_used text,
  status text not null default 'draft' check (status in ('draft', 'sent', 'failed', 'dismissed')),
  created_at timestamptz default now(),
  sent_at timestamptz
);
