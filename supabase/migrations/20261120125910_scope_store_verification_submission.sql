drop function if exists public.submit_store_verification_request();

create or replace function public.submit_store_verification_request(_store_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_store public.stores;
  v_request_id uuid;
  v_snapshot jsonb;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if _store_id is null then
    raise exception 'merchant_store_not_found';
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
  ) then
    raise exception 'email_not_confirmed';
  end if;

  select s.* into v_store
  from public.stores s
  where s.id = _store_id and s.owner_id = auth.uid()
  for update;

  if not found then
    raise exception 'merchant_store_not_found';
  end if;
  if v_store.is_verified then
    raise exception 'store_already_verified';
  end if;

  if nullif(btrim(v_store.name), '') is null
     or nullif(btrim(coalesce(v_store.logo_url, '')), '') is null
     or nullif(btrim(coalesce(v_store.phone, '')), '') is null
     or v_store.region_id is null
     or nullif(btrim(coalesce(v_store.commune, '')), '') is null
     or nullif(btrim(coalesce(v_store.address_line, '')), '') is null
     or v_store.opening_hours is null
     or jsonb_typeof(v_store.opening_hours) <> 'object'
     or coalesce(v_store.opening_hours ->> 'open', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or coalesce(v_store.opening_hours ->> 'close', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'store_verification_profile_incomplete';
  end if;

  if exists (
    select 1 from public.store_verification_requests r
    where r.store_id = v_store.id and r.status = 'pending'
  ) then
    raise exception 'store_verification_request_pending';
  end if;

  v_snapshot := jsonb_build_object(
    'name', v_store.name,
    'logo_url', v_store.logo_url,
    'phone', v_store.phone,
    'region_id', v_store.region_id,
    'secondary_region_id', v_store.secondary_region_id,
    'commune', v_store.commune,
    'address_line', v_store.address_line,
    'opening_hours', v_store.opening_hours
  );

  insert into public.store_verification_requests (
    store_id, submitted_by, status, profile_snapshot
  ) values (
    v_store.id, auth.uid(), 'pending', v_snapshot
  ) returning id into v_request_id;

  insert into public.store_verification_audit_events (
    request_id, store_id, actor_id, event_type, details
  ) values (
    v_request_id, v_store.id, auth.uid(), 'submitted',
    jsonb_build_object('profile_snapshot', v_snapshot)
  );

  update public.stores set is_verified = false where id = v_store.id;

  return v_request_id;
end;
$function$;

revoke all on function public.submit_store_verification_request(uuid) from public, anon;
grant execute on function public.submit_store_verification_request(uuid) to authenticated;
