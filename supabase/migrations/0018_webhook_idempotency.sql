-- Machine deliveries can be retried or replayed. Persist a source key and let
-- the database unique constraint provide race-safe idempotency.

alter table events_log add column source_event_key text;

create unique index events_log_source_event_key_unique
  on events_log (source_event_key)
  where source_event_key is not null;
