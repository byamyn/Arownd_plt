-- Extend store team authorization to order operations.
-- Owner remains the only authority for store identity/settings and team administration.

create or replace function private.is_store_team_member(_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.store_team_members m
    where m.store_id = _store_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin', 'staff')
  );
$$;

create or replace function private.can_manage_store_orders(_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.store_team_members m
    where m.store_id = _store_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$$;

create or replace function private.can_process_store_orders(_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.store_team_members m
    where m.store_id = _store_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin', 'staff')
  );
$$;

revoke all on function private.is_store_team_member(uuid) from public, anon, authenticated;
revoke all on function private.can_manage_store_orders(uuid) from public, anon, authenticated;
revoke all on function private.can_process_store_orders(uuid) from public, anon, authenticated;
grant execute on function private.is_store_team_member(uuid) to authenticated;
grant execute on function private.can_manage_store_orders(uuid) to authenticated;
grant execute on function private.can_process_store_orders(uuid) to authenticated;

-- Team members can read their store's merchant orders and tracking events.
drop policy if exists "Customer and store owner read merchant orders" on public.merchant_orders;
create policy "Customers and store team read merchant orders"
on public.merchant_orders
for select to authenticated
using (
  customer_id = (select auth.uid())
  or private.is_store_team_member(store_id)
);

drop policy if exists merchant_order_tracking_events_read_participants on public.merchant_order_tracking_events;
create policy merchant_order_tracking_events_read_participants
on public.merchant_order_tracking_events
for select to authenticated
using (
  exists (
    select 1 from public.merchant_orders mo
    where mo.id = merchant_order_tracking_events.merchant_order_id
      and (
        mo.customer_id = (select auth.uid())
        or private.is_store_team_member(mo.store_id)
      )
  )
);

drop policy if exists "Customers and merchants read shipments" on public.shipments;
create policy "Customers and store team read shipments"
on public.shipments
for select to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = shipments.order_id
      and o.user_id = (select auth.uid())
  )
  or (
    shipments.merchant_order_id is not null
    and exists (
      select 1 from public.merchant_orders mo
      where mo.id = shipments.merchant_order_id
        and private.is_store_team_member(mo.store_id)
    )
  )
);

-- Staff can process pending orders by submitting a quote or rejecting them.
-- Both operations remain constrained to the member's own store.
create or replace function public.merchant_reject_order(
  _merchant_order_id uuid,
  _reason text default null
)
returns public.merchant_orders
language plpgsql
security definer
set search_path = ''
as $function$
declare
  mo public.merchant_orders;
  parent_order public.orders;
  safe_reason text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if _reason is not null and char_length(btrim(_reason)) > 500 then
    raise exception 'merchant_rejection_reason_too_long';
  end if;
  if _reason is not null and btrim(_reason) ~* '(https?://|www[.])' then
    raise exception 'merchant_rejection_reason_links_not_allowed';
  end if;

  select o.* into parent_order
  from public.orders o
  join public.merchant_orders x on x.order_id = o.id
  where x.id = _merchant_order_id
  for update of o;
  if not found then raise exception 'merchant_order_not_found'; end if;

  select * into mo
  from public.merchant_orders
  where id = _merchant_order_id
  for update;

  if not private.can_process_store_orders(mo.store_id) then
    raise exception 'not_authorized';
  end if;
  if parent_order.status = 'cancelled' then
    raise exception 'parent_order_cancelled';
  end if;
  if mo.status <> 'pending' or mo.quoted_at is not null then
    raise exception 'merchant_rejection_not_available';
  end if;

  safe_reason := coalesce(
    nullif(btrim(_reason), ''),
    'المتجر غير قادر على توفير المنتجات'
  );

  update public.merchant_orders
  set status = 'cancelled', responded_at = now(), updated_at = now()
  where id = _merchant_order_id
  returning * into mo;

  update public.store_offers so
  set stock_quantity = so.stock_quantity + item_totals.quantity,
      is_available = true
  from (
    select offer_id, sum(quantity)::integer as quantity
    from public.order_items
    where merchant_order_id = mo.id and offer_id is not null
    group by offer_id
  ) item_totals
  where so.id = item_totals.offer_id;

  perform public.refresh_parent_order_totals(mo.order_id);

  insert into public.notifications (user_id, type, title, body, data)
  values (
    mo.customer_id,
    'order',
    'تعذر توفير طلب أحد المتاجر',
    'ألغى المتجر هذا الطلب قبل إرسال عرض السعر. السبب: ' || safe_reason,
    jsonb_build_object(
      'order_id', mo.order_id,
      'merchant_order_id', mo.id,
      'status', 'cancelled',
      'reason', safe_reason
    )
  );

  return mo;
end;
$function$;

create or replace function public.merchant_submit_order_quote(
  _merchant_order_id uuid,
  _shipping_fee integer
)
returns public.merchant_orders
language plpgsql
security definer
set search_path = ''
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

  if not private.can_process_store_orders(mo.store_id) then
    raise exception 'not_authorized';
  end if;
  if parent.status = 'cancelled' or mo.status <> 'pending' then
    raise exception 'quote_not_available';
  end if;
  if mo.expires_at <= now() then raise exception 'merchant_order_expired'; end if;
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

revoke all on function public.merchant_reject_order(uuid, text) from public, anon;
revoke all on function public.merchant_submit_order_quote(uuid, integer) from public, anon;
grant execute on function public.merchant_reject_order(uuid, text) to authenticated;
grant execute on function public.merchant_submit_order_quote(uuid, integer) to authenticated;
