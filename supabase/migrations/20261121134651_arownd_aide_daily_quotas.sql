create table if not exists private.arownd_aide_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  used_count integer not null default 0 check (used_count >= 0 and used_count <= 50),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (user_id, usage_date)
);

create table if not exists private.arownd_aide_minute_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  minute_bucket timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0 and request_count <= 5),
  primary key (user_id, minute_bucket)
);

revoke all on table private.arownd_aide_daily_usage from public, anon, authenticated, service_role;
revoke all on table private.arownd_aide_minute_usage from public, anon, authenticated, service_role;

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
  v_local_date date;
  v_reset_at timestamptz;
  v_minute_bucket timestamptz;
  v_used integer;
  v_requests integer;
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

  v_local_date := (v_now at time zone p_timezone)::date;
  v_reset_at := ((v_local_date + 1)::timestamp without time zone) at time zone p_timezone;
  v_minute_bucket := pg_catalog.date_trunc('minute', v_now);

  delete from private.arownd_aide_minute_usage
  where user_id = p_user_id
    and minute_bucket < v_minute_bucket - interval '2 minutes';

  delete from private.arownd_aide_daily_usage
  where user_id = p_user_id
    and usage_date < v_local_date - 35;

  insert into private.arownd_aide_daily_usage (user_id, usage_date, used_count)
  values (p_user_id, v_local_date, 1)
  on conflict (user_id, usage_date)
  do update
    set used_count = private.arownd_aide_daily_usage.used_count + 1,
        updated_at = v_now
    where private.arownd_aide_daily_usage.used_count < 50
  returning used_count into v_used;

  if v_used is null then
    select used_count into v_used
    from private.arownd_aide_daily_usage
    where user_id = p_user_id and usage_date = v_local_date;

    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'reason', 'daily_limit',
      'used', coalesce(v_used, 50),
      'remaining', 0,
      'reset_at', v_reset_at
    );
  end if;

  insert into private.arownd_aide_minute_usage (user_id, minute_bucket, request_count)
  values (p_user_id, v_minute_bucket, 1)
  on conflict (user_id, minute_bucket)
  do update
    set request_count = private.arownd_aide_minute_usage.request_count + 1
    where private.arownd_aide_minute_usage.request_count < 5
  returning request_count into v_requests;

  if v_requests is null then
    update private.arownd_aide_daily_usage
    set used_count = greatest(used_count - 1, 0),
        updated_at = v_now
    where user_id = p_user_id and usage_date = v_local_date;

    v_retry_after := greatest(
      1,
      ceil(extract(epoch from (v_minute_bucket + interval '1 minute' - v_now)))::integer
    );

    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'reason', 'rate_limit',
      'used', v_used - 1,
      'remaining', 50 - (v_used - 1),
      'retry_after_seconds', v_retry_after
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'allowed', true,
    'used', v_used,
    'remaining', 50 - v_used,
    'usage_date', v_local_date,
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

  update private.arownd_aide_daily_usage
  set used_count = greatest(used_count - 1, 0),
      updated_at = pg_catalog.clock_timestamp()
  where user_id = p_user_id
    and usage_date = p_usage_date
    and used_count > 0;

  return found;
end;
$$;

revoke all on function public.reserve_arownd_aide_request(uuid, text) from public, anon, authenticated;
revoke all on function public.release_arownd_aide_request(uuid, date) from public, anon, authenticated;
grant execute on function public.reserve_arownd_aide_request(uuid, text) to service_role;
grant execute on function public.release_arownd_aide_request(uuid, date) to service_role;
