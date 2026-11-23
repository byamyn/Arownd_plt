-- Dual-party completion for COD merchant orders.
-- Seller confirmation is captured only when the authorized COD collection RPC
-- changes payment_status to paid after the merchant order is delivered.
-- Customer confirmation is a separate authenticated RPC.
-- A dispute blocks completion; no timeout closes an order automatically.

alter table public.merchant_orders
  add column if not exists completion_status text not null default 'pending',
  add column if not exists seller_confirmed_at timestamptz,
  add column if not exists seller_confirmed_by uuid references auth.users(id) on delete restrict,
  add column if not exists customer_confirmed_at timestamptz,
  add column if not exists customer_confirmed_by uuid references auth.users(id) on delete restrict,
  add column if not exists completed_at timestamptz,
  add column if not exists disputed_at timestamptz,
  add column if not exists dispute_opened_by uuid references auth.users(id) on delete restrict,
  add column if not exists dispute_reason text;

alter table public.merchant_orders
  drop constraint if exists merchant_orders_completion_status_check;

alter table public.merchant_orders
  add constraint merchant_orders_completion_status_check
  check (completion_status in ('pending', 'disputed', 'completed'));

alter table public.merchant_orders
  drop constraint if exists merchant_orders_completion_consistency_check;

alter table public.merchant_orders
  add constraint merchant_orders_completion_consistency_check
  check (
    (
      completion_status = 'pending'
      and completed_at is null
      and disputed_at is null
      and dispute_opened_by is null
      and dispute_reason is null
    )
    or
    (
      completion_status = 'disputed'
      and completed_at is null
      and disputed_at is not null
      and dispute_opened_by is not null
      and nullif(trim(dispute_reason), '') is not null
    )
    or
    (
      completion_status = 'completed'
      and completed_at is not null
      and disputed_at is null
      and dispute_opened_by is null
      and dispute_reason is null
      and seller_confirmed_at is not null
      and seller_confirmed_by is not null
      and customer_confirmed_at is not null
      and customer_confirmed_by is not null
    )
  );

-- Existing COD records are retained as historical seller confirmations.
-- Customers must still explicitly confirm after this migration to complete them.
update public.merchant_orders mo
set seller_confirmed_at = coalesce(mo.seller_confirmed_at, cod.collected_at),
    seller_confirmed_by = coalesce(mo.seller_confirmed_by, cod.collected_by)
from public.merchant_order_cod_collections cod
where cod.merchant_order_id = mo.id
  and mo.status = 'delivered'
  and mo.payment_status = 'paid'
  and mo.seller_confirmed_at is null;

create table if not exists public.merchant_order_completion_events (
  id uuid primary key default gen_random_uuid(),
  merchant_order_id uuid not null
    references public.merchant_orders(id) on delete restrict,
  order_id uuid not null
    references public.orders(id) on delete restrict,
  action text not null
    check (action in (
      'seller_confirmed_delivery_and_cash',
      'customer_confirmed_receipt_and_payment',
      'customer_opened_dispute'
    )),
  actor_id uuid not null references auth.users(id) on delete restrict,
  actor_type text not null check (actor_type in ('seller', 'customer')),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists merchant_order_completion_events_order_idx
  on public.merchant_order_completion_events(merchant_order_id, created_at, id);

alter table public.merchant_order_completion_events enable row level security;
revoke all on public.merchant_order_completion_events from public, anon, authenticated;
grant select on public.merchant_order_completion_events to authenticated;

drop policy if exists merchant_order_completion_events_read_participants
  on public.merchant_order_completion_events;

create policy merchant_order_completion_events_read_participants
  on public.merchant_order_completion_events
  for select to authenticated
  using (
    exists (
      select 1
      from public.merchant_orders mo
      where mo.id = merchant_order_completion_events.merchant_order_id
        and (
          mo.customer_id = (select auth.uid())
          or private.is_store_team_member(mo.store_id)
          or public.has_role((select auth.uid()), 'admin'::public.app_role)
        )
    )
  );

-- Capture the seller's acknowledgement from the existing, server-authorized
-- COD collection operation. Clients cannot write this audit table directly.
create or replace function public.capture_merchant_order_seller_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid;
begin
  if old.payment_status is distinct from 'paid'
     and new.payment_status = 'paid'
     and new.status = 'delivered' then
    select c.collected_by
    into v_actor_id
    from public.merchant_order_cod_collections c
    where c.merchant_order_id = new.id;

    if v_actor_id is null then
      raise exception 'cod_collection_record_missing';
    end if;

    update public.merchant_orders
    set seller_confirmed_at = coalesce(seller_confirmed_at, new.paid_at, now()),
        seller_confirmed_by = coalesce(seller_confirmed_by, v_actor_id),
        updated_at = now()
    where id = new.id
      and seller_confirmed_at is null;

    if not exists (
      select 1
      from public.merchant_order_completion_events e
      where e.merchant_order_id = new.id
        and e.action = 'seller_confirmed_delivery_and_cash'
    ) then
      insert into public.merchant_order_completion_events (
        merchant_order_id, order_id, action, actor_id, actor_type
      ) values (
        new.id, new.order_id, 'seller_confirmed_delivery_and_cash',
        v_actor_id, 'seller'
      );
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.capture_merchant_order_seller_confirmation()
  from public, anon, authenticated;

drop trigger if exists merchant_order_capture_seller_confirmation
  on public.merchant_orders;

create trigger merchant_order_capture_seller_confirmation
after update of payment_status on public.merchant_orders
for each row
execute function public.capture_merchant_order_seller_confirmation();

-- Completion events are append-only for application roles.
create or replace function public.prevent_merchant_order_completion_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'completion_events_are_immutable';
end;
$function$;

revoke all on function public.prevent_merchant_order_completion_event_mutation()
  from public, anon, authenticated;

drop trigger if exists merchant_order_completion_events_immutable
  on public.merchant_order_completion_events;

create trigger merchant_order_completion_events_immutable
before update or delete on public.merchant_order_completion_events
for each row
execute function public.prevent_merchant_order_completion_event_mutation();

create or replace function public.customer_confirm_merchant_order_completion(
  _merchant_order_id uuid
)
returns public.merchant_orders
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.merchant_orders;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select mo.*
  into v_order
  from public.merchant_orders mo
  where mo.id = _merchant_order_id
  for update;

  if not found then
    raise exception 'merchant_order_not_found';
  end if;

  if v_order.customer_id <> auth.uid() then
    raise exception 'not_authorized';
  end if;

  if v_order.completion_status = 'disputed' then
    raise exception 'merchant_order_is_disputed';
  end if;

  if v_order.completion_status = 'completed' then
    return v_order;
  end if;

  if v_order.status <> 'delivered' then
    raise exception 'merchant_order_not_delivered';
  end if;

  if v_order.payment_status <> 'paid'
     or v_order.seller_confirmed_at is null
     or v_order.seller_confirmed_by is null then
    raise exception 'seller_confirmation_pending';
  end if;

  update public.merchant_orders
  set customer_confirmed_at = now(),
      customer_confirmed_by = auth.uid(),
      completion_status = 'completed',
      completed_at = now(),
      updated_at = now()
  where id = _merchant_order_id
  returning * into v_order;

  insert into public.merchant_order_completion_events (
    merchant_order_id, order_id, action, actor_id, actor_type
  ) values (
    v_order.id, v_order.order_id,
    'customer_confirmed_receipt_and_payment', auth.uid(), 'customer'
  );

  return v_order;
end;
$function$;

revoke all on function public.customer_confirm_merchant_order_completion(uuid)
  from public, anon;
grant execute on function public.customer_confirm_merchant_order_completion(uuid)
  to authenticated;

create or replace function public.customer_open_merchant_order_dispute(
  _merchant_order_id uuid,
  _reason text
)
returns public.merchant_orders
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.merchant_orders;
  v_reason text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  v_reason := nullif(trim(_reason), '');
  if v_reason is null or length(v_reason) > 1000 then
    raise exception 'invalid_dispute_reason';
  end if;

  select mo.*
  into v_order
  from public.merchant_orders mo
  where mo.id = _merchant_order_id
  for update;

  if not found then
    raise exception 'merchant_order_not_found';
  end if;

  if v_order.customer_id <> auth.uid() then
    raise exception 'not_authorized';
  end if;

  if v_order.completion_status = 'completed' then
    raise exception 'merchant_order_already_completed';
  end if;

  if v_order.completion_status = 'disputed' then
    return v_order;
  end if;

  update public.merchant_orders
  set completion_status = 'disputed',
      disputed_at = now(),
      dispute_opened_by = auth.uid(),
      dispute_reason = v_reason,
      updated_at = now()
  where id = _merchant_order_id
  returning * into v_order;

  insert into public.merchant_order_completion_events (
    merchant_order_id, order_id, action, actor_id, actor_type, reason
  ) values (
    v_order.id, v_order.order_id, 'customer_opened_dispute',
    auth.uid(), 'customer', v_reason
  );

  insert into public.notifications (user_id, type, title, body, data)
  select
    st.owner_id,
    'order',
    'تم فتح نزاع على الطلب',
    'فتح المشتري نزاعاً على الطلب ويحتاج إلى المراجعة.',
    jsonb_build_object(
      'order_id', v_order.order_id,
      'merchant_order_id', v_order.id,
      'completion_status', 'disputed'
    )
  from public.stores st
  where st.id = v_order.store_id
    and st.owner_id is not null;

  return v_order;
end;
$function$;

revoke all on function public.customer_open_merchant_order_dispute(uuid, text)
  from public, anon;
grant execute on function public.customer_open_merchant_order_dispute(uuid, text)
  to authenticated;
