-- Enforce a cumulative checkout quantity ceiling and bound push-device fan-out.
-- Keep the existing checkout RPC contract and serialized per-account order limit.

do $migration$
declare
  function_definition text;
  old_declaration text := '  quantity integer;';
  new_declaration text := '  quantity integer;
  total_quantity integer := 0;';
  old_validation text := '    if quantity is null or quantity < 1 or quantity > 20 then raise exception ''invalid_quantity''; end if;';
  new_validation text := '    if quantity is null or quantity < 1 or quantity > 20 then raise exception ''invalid_quantity''; end if;
    total_quantity := total_quantity + quantity;
    if total_quantity > 20 then raise exception ''order_quantity_limit_exceeded''; end if;';
begin
  select pg_get_functiondef(
    'public.create_checkout_order_for_account(jsonb,text,bigint,bigint,text,text,text,text,text,text,uuid)'::regprocedure
  ) into function_definition;
  if position(old_declaration in function_definition) = 0
     or position(old_validation in function_definition) = 0 then
    raise exception 'checkout_rpc_definition_does_not_match_expected_version';
  end if;
  function_definition := replace(function_definition, old_declaration, new_declaration);
  function_definition := replace(function_definition, old_validation, new_validation);
  execute function_definition;
end;
$migration$;

-- Do not allow an unverified account to reserve stock, even if Auth settings
-- are accidentally relaxed in the dashboard.
do $migration$
declare
  function_definition text;
  old_guard text := '  if current_user_id is null then raise exception ''not_authenticated''; end if;';
  new_guard text := '  if current_user_id is null then raise exception ''not_authenticated''; end if;
  if not exists (
    select 1 from auth.users u
    where u.id = current_user_id and u.email_confirmed_at is not null
  ) then
    raise exception ''email_not_confirmed'';
  end if;';
begin
  select pg_get_functiondef(
    'public.create_checkout_order_for_account(jsonb,text,bigint,bigint,text,text,text,text,text,text,uuid)'::regprocedure
  ) into function_definition;
  if position(old_guard in function_definition) = 0 then
    raise exception 'checkout_auth_guard_not_found';
  end if;
  function_definition := replace(function_definition, old_guard, new_guard);
  execute function_definition;
end;
$migration$;

-- Serialize registrations per user and retain at most five devices.
create or replace function public.register_my_push_device(_token text, _platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  _user_id uuid := auth.uid();
  _excess_count integer;
begin
  if _user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if _token is null or length(_token) < 20 or length(_token) > 4096 then
    raise exception 'Invalid push token' using errcode = '22023';
  end if;
  if _platform not in ('android', 'ios') then
    raise exception 'Unsupported platform' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(_user_id::text || ':push-device-limit', 0)
  );

  insert into public.push_device_tokens(user_id, token, platform, last_seen_at, updated_at)
  values (_user_id, _token, _platform, now(), now())
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        last_seen_at = now(),
        updated_at = now();

  select greatest(count(*)::integer - 5, 0)
    into _excess_count
  from public.push_device_tokens
  where user_id = _user_id;

  if _excess_count > 0 then
    delete from public.push_device_tokens
    where id in (
      select id
      from public.push_device_tokens
      where user_id = _user_id
        and token <> _token
      order by last_seen_at asc, created_at asc, id asc
      limit _excess_count
    );
  end if;
end;
$function$;

revoke all on function public.register_my_push_device(text, text)
  from public, anon;
grant execute on function public.register_my_push_device(text, text)
  to authenticated;
