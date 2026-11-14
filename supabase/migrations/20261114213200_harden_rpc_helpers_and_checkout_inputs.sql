-- Arownd security hardening: private ownership helpers, hardened definer paths and checkout payload bounds.
-- This migration is staged for review only; it is not applied to production.

-- Move ownership predicates out of the exposed public schema. PostgreSQL updates
-- policy dependencies to the moved function OIDs automatically.
alter function public.is_store_owner(uuid) set schema private;
alter function public.is_order_owner(uuid) set schema private;
alter function public.is_offer_owner(uuid) set schema private;
alter function public.is_order_merchant(uuid) set schema private;

revoke all on function private.is_store_owner(uuid) from public, anon;
revoke all on function private.is_order_owner(uuid) from public, anon;
revoke all on function private.is_offer_owner(uuid) from public, anon;
revoke all on function private.is_order_merchant(uuid) from public, anon;

grant usage on schema private to authenticated;
grant execute on function private.is_store_owner(uuid) to authenticated;
grant execute on function private.is_order_owner(uuid) to authenticated;
grant execute on function private.is_offer_owner(uuid) to authenticated;
grant execute on function private.is_order_merchant(uuid) to authenticated;

alter function private.is_store_owner(uuid) set search_path = '';
alter function private.is_order_owner(uuid) set search_path = '';
alter function private.is_offer_owner(uuid) set search_path = '';
alter function private.is_order_merchant(uuid) set search_path = '';

-- PL/pgSQL stores function bodies as source text, so update explicit helper
-- references in dependent routines after moving the helper functions.
do $migration$
declare
  fn record;
  definition text;
begin
  for fn in
    select p.oid
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and (
        pg_catalog.position('public.is_store_owner(' in p.prosrc) > 0
        or pg_catalog.position('public.is_order_owner(' in p.prosrc) > 0
        or pg_catalog.position('public.is_offer_owner(' in p.prosrc) > 0
        or pg_catalog.position('public.is_order_merchant(' in p.prosrc) > 0
      )
  loop
    definition := pg_catalog.pg_get_functiondef(fn.oid);
    definition := pg_catalog.replace(definition, 'public.is_store_owner(', 'private.is_store_owner(');
    definition := pg_catalog.replace(definition, 'public.is_order_owner(', 'private.is_order_owner(');
    definition := pg_catalog.replace(definition, 'public.is_offer_owner(', 'private.is_offer_owner(');
    definition := pg_catalog.replace(definition, 'public.is_order_merchant(', 'private.is_order_merchant(');
    execute definition;
  end loop;
end;
$migration$;

-- Use an empty search_path for every public SECURITY DEFINER routine that
-- previously relied on public being implicitly trusted.
do $migration$
declare
  fn record;
begin
  for fn in
    select p.oid
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and exists (
        select 1
        from pg_catalog.unnest(p.proconfig) setting
        where setting like 'search_path=public%'
      )
  loop
    execute pg_catalog.format(
      'alter function %s set search_path = %L',
      fn.oid::pg_catalog.regprocedure,
      ''
    );
  end loop;
end;
$migration$;

-- Bound the checkout JSON payload at the server boundary. Cart options are
-- represented by a JSON object of string selections in the mobile client.
do $migration$
declare
  definition text;
  old_fragment text := $old$    if jsonb_typeof(it) <> 'object' then raise exception 'invalid_item'; end if;$old$;
  new_fragment text := $new$    if jsonb_typeof(it) <> 'object' then raise exception 'invalid_item'; end if;
    if jsonb_typeof(coalesce(it -> 'options', '{}'::jsonb)) is distinct from 'object'
       or octet_length(coalesce(it -> 'options', '{}'::jsonb)::text) > 2048 then
      raise exception 'invalid_item_options';
    end if;$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.create_checkout_order_for_account(jsonb,text,bigint,bigint,text,text,text,text,text,text,uuid)'::pg_catalog.regprocedure
  )
  into definition;

  if pg_catalog.position(old_fragment in definition) = 0 then
    raise exception 'checkout_function_source_does_not_match_expected_version';
  end if;

  definition := pg_catalog.replace(definition, old_fragment, new_fragment);
  execute definition;
end;
$migration$;

-- Limit the total JSON input as well as each options object.
create or replace function public.create_checkout_order_for_account(
  _items jsonb,
  _delivery_type text,
  _region_id bigint,
  _secondary_region_id bigint,
  _commune text,
  _address_line text,
  _full_name text,
  _phone text,
  _payment_method text,
  _receipt_url text,
  _idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
  account_country_code text;
  account_currency_code text;
  it jsonb;
  offer_row public.store_offers;
  product_name text;
  quantity integer;
  created_order_id uuid;
  normalized_hash text;
  previous_hash text;
  previous_order_id uuid;
  active_order_count integer;
begin
  if current_user_id is null then raise exception 'not_authenticated'; end if;
  if _idempotency_key is null then raise exception 'idempotency_key_required'; end if;
  if _payment_method is distinct from 'cod' then raise exception 'invalid_payment_method'; end if;
  if _receipt_url is not null then raise exception 'unexpected_receipt'; end if;
  if _delivery_type is null or _delivery_type not in ('home', 'desk') then raise exception 'invalid_delivery_type'; end if;
  if _items is null or jsonb_typeof(_items) is distinct from 'array'
     or jsonb_array_length(_items) < 1 or jsonb_array_length(_items) > 30
     or octet_length(_items::text) > 65536 then
    raise exception 'invalid_items';
  end if;
  if _region_id is null
     or nullif(btrim(_commune), '') is null
     or length(_commune) > 100
     or nullif(btrim(_address_line), '') is null
     or length(_address_line) > 300
     or length(btrim(_full_name)) < 2
     or length(_full_name) > 120
     or _phone is null or length(_phone) > 30 then
    raise exception 'invalid_order_contact';
  end if;

  select p.country_code, c.currency_code
    into account_country_code, account_currency_code
  from public.profiles p
  join public.countries c on c.code = p.country_code
  where p.user_id = current_user_id;
  if not found then raise exception 'profile_not_found'; end if;

  normalized_hash := md5(jsonb_build_object(
    'items', _items,
    'delivery_type', _delivery_type,
    'country_code', account_country_code,
    'region_id', _region_id,
    'secondary_region_id', _secondary_region_id,
    'commune', _commune,
    'address_line', _address_line,
    'full_name', _full_name,
    'phone', _phone,
    'payment_method', _payment_method,
    'receipt_url', _receipt_url
  )::text);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text || ':' || _idempotency_key::text, 0)
  );

  select ci.request_hash, ci.order_id
    into previous_hash, previous_order_id
  from public.checkout_idempotency ci
  where ci.user_id = current_user_id
    and ci.idempotency_key = _idempotency_key;

  if found then
    if previous_hash <> normalized_hash then
      raise exception 'idempotency_key_reused_with_different_request';
    end if;
    if previous_order_id is null then raise exception 'idempotent_order_no_longer_available'; end if;
    return previous_order_id;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text || ':pending-checkout-limit', 0)
  );

  select count(*)::integer
    into active_order_count
  from (
    select distinct mo.order_id
    from public.merchant_orders mo
    where mo.customer_id = current_user_id
      and mo.status in ('pending', 'quoted')
      and mo.expires_at > now()
  ) active_orders;

  if active_order_count >= 5 then
    raise exception 'pending_order_limit_reached';
  end if;

  insert into public.orders (
    user_id, full_name, phone, wilaya_id, country_code, region_id,
    secondary_region_id, daira_region_id, currency_code, commune,
    address_line, delivery_type, delivery_method, payment_method, receipt_url,
    subtotal, shipping_fee, total, commission_amount
  ) values (
    current_user_id, btrim(_full_name), btrim(_phone), null,
    account_country_code, _region_id, _secondary_region_id, null,
    account_currency_code, btrim(_commune), btrim(_address_line),
    _delivery_type,
    case when _delivery_type = 'home' then 'delivery' else 'store_pickup' end,
    'cod', null, 0, 0, 0, 0
  ) returning id into created_order_id;

  for it in select value from jsonb_array_elements(_items) loop
    if jsonb_typeof(it) <> 'object' then raise exception 'invalid_item'; end if;
    if jsonb_typeof(coalesce(it -> 'options', '{}'::jsonb)) is distinct from 'object'
       or octet_length(coalesce(it -> 'options', '{}'::jsonb)::text) > 2048 then
      raise exception 'invalid_item_options';
    end if;

    begin
      quantity := (it ->> 'quantity')::integer;
    exception when others then
      raise exception 'invalid_quantity';
    end;
    if quantity is null or quantity < 1 or quantity > 20 then raise exception 'invalid_quantity'; end if;
    if it ->> 'offer_id' is null then raise exception 'invalid_item'; end if;

    select * into offer_row
    from public.store_offers
    where id = (it ->> 'offer_id')::uuid
    for update;
    if not found or not offer_row.is_available or offer_row.stock_quantity < quantity then
      raise exception 'out_of_stock';
    end if;

    if exists (
      select 1
      from public.stores st
      where st.id = offer_row.store_id
        and st.owner_id = current_user_id
    ) then
      raise exception 'cannot_purchase_own_store';
    end if;

    if not exists (
      select 1 from public.stores s
      where s.id = offer_row.store_id
        and s.country_code = account_country_code
    ) then
      raise exception 'order_store_country_mismatch';
    end if;

    select p.name into product_name
    from public.products p where p.id = offer_row.product_id;

    insert into public.order_items (
      order_id, offer_id, store_id, product_name, unit_price, quantity, options
    ) values (
      created_order_id, offer_row.id, offer_row.store_id, product_name,
      offer_row.price, quantity, coalesce(it -> 'options', '{}'::jsonb)
    );

    update public.store_offers
    set stock_quantity = stock_quantity - quantity
    where id = offer_row.id;
  end loop;

  perform public.refresh_parent_order_totals(created_order_id);

  insert into public.checkout_idempotency (
    user_id, idempotency_key, request_hash, order_id
  ) values (
    current_user_id, _idempotency_key, normalized_hash, created_order_id
  );

  return created_order_id;
end;
$function$;
