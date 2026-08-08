-- One-time outbound dial and Media Stream authorization. Callers receive only
-- random grants; the database retains their SHA-256 digests, actor/session
-- binding, expiry, and atomic consumption timestamps. Hub owns these existing
-- call/live tables.

alter table live_sessions
  add column dial_grant_hash text unique,
  add column dial_actor_auth_user_id text,
  add column dial_grant_expires_at timestamptz,
  add column dial_started_at timestamptz,
  add column media_stream_grant_hash text unique,
  add column media_stream_grant_expires_at timestamptz,
  add column media_stream_started_at timestamptz;

-- A deployment cannot safely continue a pre-grant Twilio session. Close only
-- those legacy active rows; ended history remains readable below.
update live_sessions
set status = 'ended', ended_at = coalesce(ended_at, now())
where mode = 'twilio' and status = 'active' and dial_grant_hash is null;

alter table live_sessions add constraint live_dial_grant_shape check (
  (
    mode = 'simulator'
    and dial_grant_hash is null
    and dial_actor_auth_user_id is null
    and dial_grant_expires_at is null
    and dial_started_at is null
    and media_stream_grant_hash is null
    and media_stream_grant_expires_at is null
    and media_stream_started_at is null
  )
  or
  (
    mode = 'twilio'
    and dial_grant_hash is not null
    and dial_actor_auth_user_id is not null
    and dial_grant_expires_at is not null
    and (
      (
        media_stream_grant_hash is null
        and media_stream_grant_expires_at is null
        and media_stream_started_at is null
      )
      or
      (
        dial_started_at is not null
        and media_stream_grant_hash is not null
        and media_stream_grant_expires_at is not null
      )
    )
  )
  or
  (
    mode = 'twilio'
    and status = 'ended'
    and dial_grant_hash is null
    and dial_actor_auth_user_id is null
    and dial_grant_expires_at is null
    and dial_started_at is null
    and media_stream_grant_hash is null
    and media_stream_grant_expires_at is null
    and media_stream_started_at is null
  )
);

create index live_sessions_dial_grant_expires_idx
  on live_sessions (dial_grant_expires_at)
  where mode = 'twilio' and dial_started_at is null;

create index live_sessions_media_stream_grant_expires_idx
  on live_sessions (media_stream_grant_expires_at)
  where mode = 'twilio' and media_stream_started_at is null;
