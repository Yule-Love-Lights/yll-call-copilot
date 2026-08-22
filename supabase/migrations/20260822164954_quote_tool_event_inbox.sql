-- Durable Flow Q inbox. Quote Tool remains canonical; Hub stores only the
-- received envelope, application state, and operational retry/DLQ metadata.

create table public.quote_tool_event_inbox (
  source_event_id uuid primary key,
  aggregate_id text not null,
  entity_version integer not null check (entity_version >= 1),
  event_type text not null,
  source_outbox_sequence bigint not null check (source_outbox_sequence >= 1),
  payload jsonb not null,
  received_at timestamptz not null default now(),
  applied_at timestamptz,
  retry_after timestamptz,
  delivery_attempts integer not null default 0 check (delivery_attempts >= 0),
  last_error text,
  dead_lettered_at timestamptz,
  constraint quote_tool_event_inbox_state check (
    (applied_at is not null and retry_after is null and dead_lettered_at is null)
    or (applied_at is null and dead_lettered_at is null)
    or (applied_at is null and dead_lettered_at is not null)
  ),
  unique (source_outbox_sequence)
);

create index quote_tool_event_inbox_pending_idx
  on public.quote_tool_event_inbox (retry_after nulls first, source_outbox_sequence)
  where applied_at is null and dead_lettered_at is null;
create index quote_tool_event_inbox_aggregate_idx
  on public.quote_tool_event_inbox (aggregate_id, entity_version desc);

create table public.quote_tool_feed_state (
  singleton boolean primary key default true check (singleton),
  applied_cursor text,
  source_watermark text,
  updated_at timestamptz not null default now()
);
insert into public.quote_tool_feed_state (singleton) values (true)
on conflict (singleton) do nothing;

create table public.quote_tool_event_dead_letters (
  source_event_id uuid primary key references public.quote_tool_event_inbox(source_event_id),
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  failure_count integer not null default 1 check (failure_count >= 1),
  last_error text not null,
  resolved_at timestamptz,
  resolved_by_employee_id uuid references public.ops_employees(id),
  resolution_reason text
);

alter table public.quote_tool_event_inbox enable row level security;
alter table public.quote_tool_event_inbox force row level security;
alter table public.quote_tool_feed_state enable row level security;
alter table public.quote_tool_feed_state force row level security;
alter table public.quote_tool_event_dead_letters enable row level security;
alter table public.quote_tool_event_dead_letters force row level security;

revoke all privileges on table public.quote_tool_event_inbox, public.quote_tool_feed_state, public.quote_tool_event_dead_letters
  from public, anon, authenticated, service_role;
grant select on table public.quote_tool_event_inbox, public.quote_tool_feed_state, public.quote_tool_event_dead_letters to service_role;
