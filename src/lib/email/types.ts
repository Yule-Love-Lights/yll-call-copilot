// Shared shapes for Workstream 6 (fast on-brand email replies). Row shapes
// mirror supabase/migrations/0012_email.sql -- same convention as
// leads/types.ts and playbook/types.ts (only the columns the app reads and
// writes, not a full generated schema).

export type EmailSource = 'ghl' | 'gmail';
export type EmailIntent = 'buyer' | 'question' | 'service' | 'other';
export type InboundEmailStatus = 'new' | 'drafted' | 'sent' | 'dismissed';
export type EmailReplyDraftStatus = 'draft' | 'sent' | 'failed' | 'dismissed';

export type InboundEmailRow = {
  id: string;
  source: EmailSource;
  source_message_id: string | null;
  ghl_contact_id: string | null;
  ghl_conversation_id: string | null;
  from_address: string | null;
  from_name: string | null;
  subject: string | null;
  body: string;
  received_at: string | null;
  intent: EmailIntent | null;
  status: InboundEmailStatus;
  created_at: string;
};

export type EmailReplyDraftRow = {
  id: string;
  inbound_email_id: string;
  subject: string;
  body: string;
  intent: EmailIntent | null;
  guarantee_used: string | null;
  status: EmailReplyDraftStatus;
  created_at: string;
  sent_at: string | null;
};
