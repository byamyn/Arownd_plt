begin;

-- Production currently has migrations through 20261114182927.
-- Keep this migration after that point and preserve the deployed RPC contracts.

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

alter table public.merchant_orders
  add column if not exists expires_at timestamptz;

update public.merchant_orders
set expires_at = created_at + interval '24 hours'
where expires_at is null;

alter table public.merchant_orders
  alter column expires_at set default (now() + interval '24 hours'),
  alter column expires_at set not null;

create index if not exists merchant_orders_expiry_idx
  on public.merchant_orders (expires_at, id)
  where status in ('pending', 'quoted');

create or replace function public.expire_stale_checkout_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  expired_row record;
  expired_count integer := 0;
begin
  for expired_row in
    select mo.id, mo.order_id, mo.store_id
    from public.merchant_orders mo
    join public.orders o on o.id = mo.order_id
    where mo.status in ('pending', 'quoted')
      and mo.expires_at <= now()
    order by mo.expires_at, mo.id
    limit 100
    for update of o, mo skip locked
  loop
    update public.merchant_orders
    set status = 'cancelled',
        responded_at = now(),
        updated_at = now()
    where id = expired_row.id
      and status in ('pending', 'quoted');

    if not found then
      continue;
    end if;

    -- The existing BEFORE trigger derives is_available from stock_quantity
    -- and is_merchant_hidden, so hidden offers remain hidden.
    update public.store_offers so
    set stock_quantity = so.stock_quantity + item_totals.quantity
    from (
      select oi.offer_id, sum(oi.quantity)::integer as quantity
      from public.order_items oi
      where oi.merchant_order_id = expired_row.id
        and oi.offer_id is not null
      group by oi.offer_id
    ) item_totals
    where so.id = item_totals.offer_id;

    perform public.refresh_parent_order_totals(expired_row.order_id);

    -- merchant_orders status trigger already notifies the customer.
    insert into public.notifications (user_id, type, title, body, data)
    select st.owner_id,
      'order',
      'انتهت صلاحية طلب غير مؤكد',
      'أُلغي الطلب تلقائياً بعد مرور 24 ساعة دون تأكيده، وأُعيدت الكمية إلى المخزون.',
      jsonb_build_object(
        'order_id', expired_row.order_id,
        'merchant_order_id', expired_row.id,
        'status', 'cancelled',
        'reason', 'expired'
      )
    from public.stores st
    where st.id = expired_row.store_id
      and st.owner_id is not null;

    expired_count := expired_count + 1;
  end loop;

  return expired_count;
end;
$function$;

revoke all on function public.expire_stale_checkout_orders()
  from public, anon, authenticated;

-- Preserve the deployed RPC signature, validation, idempotency and checkout
-- behavior while adding a serialized five-active-parent-order limit and
-- rejecting purchases from the buyer's own store.
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
     or jsonb_array_length(_items) < 1 or jsonb_array_length(_items) > 30 then
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

revoke all on function public.create_checkout_order_for_account(
  jsonb, text, bigint, bigint, text, text, text, text, text, text, uuid
) from public, anon;
grant execute on function public.create_checkout_order_for_account(
  jsonb, text, bigint, bigint, text, text, text, text, text, text, uuid
) to authenticated;

create or replace function public.merchant_submit_order_quote(
  _merchant_order_id uuid,
  _shipping_fee integer
)
returns public.merchant_orders
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  mo public.merchant_orders;
  parent public.orders;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if _shipping_fee is null or _shipping_fee < 0 or _shipping_fee > 1000000 then
    raise exception 'invalid_shipping_fee';
  end if;

  select o.* into parent
  from public.orders o
  join public.merchant_orders x on x.order_id = o.id
  where x.id = _merchant_order_id
  for update of o;
  if not found then raise exception 'merchant_order_not_found'; end if;

  select * into mo
  from public.merchant_orders
  where id = _merchant_order_id
  for update;

  if not public.is_store_owner(mo.store_id) then
    raise exception 'not_authorized';
  end if;
  if parent.status = 'cancelled' or mo.status <> 'pending' then
    raise exception 'quote_not_available';
  end if;
  if mo.expires_at <= now() then
    raise exception 'merchant_order_expired';
  end if;
  if parent.delivery_type = 'desk' and _shipping_fee <> 0 then
    raise exception 'pickup_shipping_must_be_free';
  end if;

  update public.merchant_orders
  set shipping_fee = _shipping_fee,
      status = 'quoted',
      quoted_at = now(),
      updated_at = now()
  where id = _merchant_order_id
  returning * into mo;

  perform public.refresh_parent_order_totals(mo.order_id);

  insert into public.notifications (user_id, type, title, body, data)
  values (
    mo.customer_id,
    'order',
    'عرض المتجر جاهز للموافقة',
    'قيمة المنتجات: ' || mo.subtotal::text || ' ' || parent.currency_code ||
      '، التوصيل: ' || mo.shipping_fee::text || ' ' || parent.currency_code ||
      '، الإجمالي: ' || (mo.subtotal + mo.shipping_fee)::text || ' ' ||
      parent.currency_code || '. راجع العرض ووافق أو ارفض هذا الطلب.',
    jsonb_build_object(
      'order_id', mo.order_id,
      'merchant_order_id', mo.id,
      'subtotal', mo.subtotal,
      'shipping_fee', mo.shipping_fee,
      'total', mo.subtotal + mo.shipping_fee,
      'currency_code', parent.currency_code,
      'url', '/orders/' || mo.order_id::text
    )
  );

  return mo;
end;
$function$;

revoke all on function public.merchant_submit_order_quote(uuid, integer)
  from public, anon;
grant execute on function public.merchant_submit_order_quote(uuid, integer)
  to authenticated;

create or replace function public.customer_respond_to_merchant_order(
  _merchant_order_id uuid,
  _accept boolean
)
returns public.merchant_orders
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  mo public.merchant_orders;
  parent public.orders;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if _accept is null then raise exception 'invalid_quote_response'; end if;

  select o.* into parent
  from public.orders o
  join public.merchant_orders x on x.order_id = o.id
  where x.id = _merchant_order_id
  for update of o;
  if not found then raise exception 'merchant_order_not_found'; end if;

  select * into mo
  from public.merchant_orders
  where id = _merchant_order_id
  for update;

  if mo.customer_id <> auth.uid() then raise exception 'not_authorized'; end if;
  if mo.status <> 'quoted' then raise exception 'quote_response_not_available'; end if;
  if mo.expires_at <= now() then raise exception 'merchant_order_expired'; end if;

  if _accept then
    update public.merchant_orders
    set status = 'confirmed', responded_at = now(), updated_at = now()
    where id = _merchant_order_id
    returning * into mo;
  else
    update public.merchant_orders
    set status = 'cancelled', responded_at = now(), updated_at = now()
    where id = _merchant_order_id
    returning * into mo;

    update public.store_offers so
    set stock_quantity = so.stock_quantity + item_totals.quantity
    from (
      select offer_id, sum(quantity)::integer as quantity
      from public.order_items
      where merchant_order_id = mo.id
        and offer_id is not null
      group by offer_id
    ) item_totals
    where so.id = item_totals.offer_id;
  end if;

  perform public.refresh_parent_order_totals(mo.order_id);

  insert into public.notifications (user_id, type, title, body, data)
  select
    st.owner_id,
    'order',
    case when _accept then 'وافق المشتري على عرضك' else 'رفض المشتري عرض المتجر' end,
    case
      when not _accept then 'رفض المشتري عرض السعر؛ تم إلغاء هذا الطلب الفرعي وإرجاع الكمية للمخزون.'
      when parent.delivery_type = 'home' then 'وافق المشتري على السعر النهائي. جهّز الطلب وتولَّ توصيله مباشرة.'
      else 'وافق المشتري على السعر النهائي. جهّز الطلب وأشعر المشتري عندما يصبح جاهزًا للاستلام من المتجر.'
    end,
    jsonb_build_object('order_id', mo.order_id, 'merchant_order_id', mo.id)
  from public.stores st
  where st.id = mo.store_id and st.owner_id is not null;

  return mo;
end;
$function$;

revoke all on function public.customer_respond_to_merchant_order(uuid, boolean)
  from public, anon;
grant execute on function public.customer_respond_to_merchant_order(uuid, boolean)
  to authenticated;

-- A merchant cannot create a self-purchase. This also excludes any legacy
-- self-purchase from the verified-review eligibility calculation.
create or replace function public.submit_review(
  _target_type public.review_target_type,
  _target_id uuid,
  _rating integer,
  _comment text default null
)
returns public.reviews
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  review_row public.reviews;
  normalized_comment text := nullif(btrim(_comment), '');
  is_eligible boolean := false;
begin
  if actor_id is null then raise exception 'not_authenticated'; end if;
  if _rating is null or _rating < 1 or _rating > 5 then raise exception 'invalid_rating'; end if;
  if normalized_comment is not null and char_length(normalized_comment) > 1000 then
    raise exception 'review_comment_too_long';
  end if;

  if _target_type = 'product' then
    if not exists (select 1 from public.products p where p.id = _target_id) then
      raise exception 'review_target_not_found';
    end if;

    select exists (
      select 1
      from public.merchant_orders mo
      join public.order_items oi on oi.merchant_order_id = mo.id
      join public.store_offers so on so.id = oi.offer_id
      join public.stores st on st.id = mo.store_id
      where mo.customer_id = actor_id
        and mo.status = 'delivered'
        and st.owner_id is distinct from actor_id
        and so.product_id = _target_id
      union all
      select 1
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
      join public.store_offers so on so.id = oi.offer_id
      join public.stores st on st.id = oi.store_id
      where o.user_id = actor_id
        and o.status = 'delivered'
        and st.owner_id is distinct from actor_id
        and so.product_id = _target_id
        and not exists (select 1 from public.merchant_orders mo where mo.order_id = o.id)
      union all
      select 1
      from public.reservations r
      join public.store_offers so on so.id = r.offer_id
      join public.stores st on st.id = r.store_id
      where r.user_id = actor_id
        and r.status = 'collected'
        and st.owner_id is distinct from actor_id
        and so.product_id = _target_id
    ) into is_eligible;
  else
    if not exists (
      select 1 from public.stores s
      where s.id = _target_id
        and s.owner_id is distinct from actor_id
    ) then
      raise exception 'review_target_not_found';
    end if;

    select exists (
      select 1
      from public.merchant_orders mo
      join public.stores st on st.id = mo.store_id
      where mo.customer_id = actor_id
        and mo.status = 'delivered'
        and mo.store_id = _target_id
        and st.owner_id is distinct from actor_id
      union all
      select 1
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
      join public.stores st on st.id = oi.store_id
      where o.user_id = actor_id
        and o.status = 'delivered'
        and oi.store_id = _target_id
        and st.owner_id is distinct from actor_id
        and not exists (select 1 from public.merchant_orders mo where mo.order_id = o.id)
      union all
      select 1
      from public.reservations r
      join public.stores st on st.id = r.store_id
      where r.user_id = actor_id
        and r.status = 'collected'
        and r.store_id = _target_id
        and st.owner_id is distinct from actor_id
    ) into is_eligible;
  end if;

  if not is_eligible then raise exception 'review_not_verified'; end if;

  insert into public.reviews (
    user_id, target_type, target_id, rating, comment, status
  )
  values (actor_id, _target_type, _target_id, _rating, normalized_comment, 'pending')
  on conflict (user_id, target_type, target_id)
  do update set
    rating = excluded.rating,
    comment = excluded.comment,
    status = 'pending',
    updated_at = now()
  returning * into review_row;

  return review_row;
end;
$function$;

revoke all on function public.submit_review(public.review_target_type, uuid, integer, text)
  from public, anon;
grant execute on function public.submit_review(public.review_target_type, uuid, integer, text)
  to authenticated;

do $schedule$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname = 'arownd-expire-stale-checkout-orders'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'arownd-expire-stale-checkout-orders',
    '*/5 * * * *',
    'select public.expire_stale_checkout_orders();'
  );
end;
$schedule$;

commit;
