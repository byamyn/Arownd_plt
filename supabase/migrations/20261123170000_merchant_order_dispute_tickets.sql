-- One dispute ticket per merchant order.
-- Ticket lifecycle is explicit and has no timeout-based auto-close.

create table if not exists public.merchant_order_disputes (
  id uuid primary key default gen_random_uuid(),
  merchant_order_id uuid not null unique
    references public.merchant_orders(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  store_id uuid not null references public.stores(id) on delete restrict,
  customer_id uuid not null references auth.users(id) on delete restrict,
  opened_by uuid not null references auth.users(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  status text not null default 'open'
    check (status in ('open', 'in_review', 'resolved')),
  resolution_note text,
  resolved_by uuid references auth.users(id) on delete restrict,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_order_disputes_resolution_check check (
    (status = 'resolved' and resolved_by is not null and resolved_at is not null)
    or
    (status in ('open', 'in_review') and resolved_by is null and resolved_at is null)
  )
);

create index if not exists merchant_order_disputes_order_id_idx
  on public.merchant_order_disputes(order_id);
create index if not exists merchant_order_disputes_store_id_idx
  on public.merchant_order_disputes(store_id);
create index if not exists merchant_order_disputes_customer_id_idx
  on public.merchant_order_disputes(customer_id);
create index if not exists merchant_order_disputes_opened_by_idx
  on public.merchant_order_disputes(opened_by);
create index if not exists merchant_order_disputes_resolved_by_idx
  on public.merchant_order_disputes(resolved_by)
  where resolved_by is not null;

alter table public.merchant_order_disputes enable row level security;
revoke all on public.merchant_order_disputes from public, anon, authenticated;
grant select on public.merchant_order_disputes to authenticated;

drop policy if exists merchant_order_disputes_read_participants
  on public.merchant_order_disputes;

create policy merchant_order_disputes_read_participants
  on public.merchant_order_disputes
  for select to authenticated
  using (
    customer_id = (select auth.uid())
    or private.is_store_team_member(store_id)
  );

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

  if v_order.status in ('cancelled', 'rejected') then
    raise exception 'merchant_order_not_disputable';
  end if;

  if v_order.completion_status = 'disputed' then
    return v_order;
  end if;

  insert into public.merchant_order_disputes (
    merchant_order_id, order_id, store_id, customer_id, opened_by, reason
  ) values (
    v_order.id, v_order.order_id, v_order.store_id,
    v_order.customer_id, auth.uid(), v_reason
  );

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
      'dispute_id', d.id,
      'completion_status', 'disputed'
    )
  from public.stores st
  join public.merchant_order_disputes d
    on d.merchant_order_id = v_order.id
  where st.id = v_order.store_id
    and st.owner_id is not null;

  return v_order;
end;
$function$;

revoke all on function public.customer_open_merchant_order_dispute(uuid, text)
  from public, anon;
grant execute on function public.customer_open_merchant_order_dispute(uuid, text)
  to authenticated;
