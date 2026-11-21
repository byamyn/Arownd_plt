create table private.arownd_aide_quota_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone_name text not null,
  usage_date date not null,
  reset_at timestamptz not null,
  used_count integer not null default 0 check (used_count >= 0 and used_count <= 50),
  minute_bucket timestamptz not null,
  minute_count integer not null default 0 check (minute_count >= 0 and minute_count <= 5),
  updated_at timestamptz not null default pg_catalog.now()
);

revoke all on table private.arownd_aide_quota_state from public, anon, authenticated, service_role;

create or replace function public.reserve_arownd_aide_request(
  p_user_id uuid,
  p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_timezone text;
  v_usage_date date;
  v_reset_at timestamptz;
  v_minute_bucket timestamptz := pg_catalog.date_trunc('minute', pg_catalog.clock_timestamp());
  v_used integer;
  v_minute_count integer;
  v_retry_after integer;
begin
  if p_user_id is null then
    return pg_catalog.jsonb_build_object('allowed', false, 'reason', 'unauthorized');
  end if;

  if p_timezone is null or pg_catalog.length(p_timezone) > 64
     or not exists (
       select 1
       from pg_catalog.pg_timezone_names tz
       where tz.name = p_timezone
     ) then
    return pg_catalog.jsonb_build_object('allowed', false, 'reason', 'invalid_timezone');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 17011986)
  );

  select timezone_name, usage_date, reset_at, used_count, minute_bucket, minute_count
  into v_timezone, v_usage_date, v_reset_at, v_used, v_minute_bucket, v_minute_count
  from private.arownd_aide_quota_state
  where user_id = p_user_id
  for update;

  if not found then
    v_timezone := p_timezone;
    v_usage_date := (v_now at time zone v_timezone)::date;
    v_reset_at := ((v_usage_date + 1)::timestamp without time zone) at time zone v_timezone;
    v_used := 0;
    v_minute_bucket := pg_catalog.date_trunc('minute', v_now);
    v_minute_count := 0;

    insert into private.arownd_aide_quota_state (
      user_id, timezone_name, usage_date, reset_at, used_count, minute_bucket, minute_count, updated_at
    ) values (
      p_user_id, v_timezone, v_usage_date, v_reset_at, 0, v_minute_bucket, 0, v_now
    );
  elsif v_now >= v_reset_at then
    v_timezone := p_timezone;
    v_usage_date := (v_now at time zone v_timezone)::date;
    v_reset_at := ((v_usage_date + 1)::timestamp without time zone) at time zone v_timezone;
    v_used := 0;
    v_minute_bucket := pg_catalog.date_trunc('minute', v_now);
    v_minute_count := 0;
  elsif v_minute_bucket <> pg_catalog.date_trunc('minute', v_now) then
    v_minute_bucket := pg_catalog.date_trunc('minute', v_now);
    v_minute_count := 0;
  end if;

  if v_used >= 50 then
    update private.arownd_aide_quota_state
    set timezone_name = v_timezone,
        usage_date = v_usage_date,
        reset_at = v_reset_at,
        minute_bucket = v_minute_bucket,
        minute_count = v_minute_count,
        updated_at = v_now
    where user_id = p_user_id;

    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'reason', 'daily_limit',
      'used', v_used,
      'remaining', 0,
      'reset_at', v_reset_at
    );
  end if;

  if v_minute_count >= 5 then
    v_retry_after := greatest(
      1,
      ceil(extract(epoch from (v_minute_bucket + interval '1 minute' - v_now)))::integer
    );

    update private.arownd_aide_quota_state
    set timezone_name = v_timezone,
        usage_date = v_usage_date,
        reset_at = v_reset_at,
        minute_bucket = v_minute_bucket,
        updated_at = v_now
    where user_id = p_user_id;

    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'reason', 'rate_limit',
      'used', v_used,
      'remaining', 50 - v_used,
      'retry_after_seconds', v_retry_after
    );
  end if;

  update private.arownd_aide_quota_state
  set timezone_name = v_timezone,
      usage_date = v_usage_date,
      reset_at = v_reset_at,
      used_count = v_used + 1,
      minute_bucket = v_minute_bucket,
      minute_count = v_minute_count + 1,
      updated_at = v_now
  where user_id = p_user_id;

  return pg_catalog.jsonb_build_object(
    'allowed', true,
    'used', v_used + 1,
    'remaining', 49 - v_used,
    'usage_date', v_usage_date,
    'reset_at', v_reset_at
  );
end;
$$;

create or replace function public.release_arownd_aide_request(
  p_user_id uuid,
  p_usage_date date
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_usage_date is null then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 17011986)
  );

  update private.arownd_aide_quota_state
  set used_count = greatest(used_count - 1, 0),
      updated_at = pg_catalog.clock_timestamp()
  where user_id = p_user_id
    and usage_date = p_usage_date
    and used_count > 0;

  return found;
end;
$$;

drop table private.arownd_aide_daily_usage;
drop table private.arownd_aide_minute_usage;
