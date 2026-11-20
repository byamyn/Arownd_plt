create or replace function private.is_order_merchant(_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.order_items i
    where i.order_id = _order_id
      and private.is_store_team_member(i.store_id)
  );
$function$;

drop policy if exists "Order items read" on public.order_items;
create policy "Order items read"
on public.order_items
for select
to authenticated
using (
  private.is_order_owner(order_id)
  or private.is_store_team_member(store_id)
);

create or replace function public.fetch_merchant_order_tracking(_merchant_order_id uuid)
returns setof public.merchant_order_tracking_events
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.merchant_orders;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_order
  from public.merchant_orders
  where id = _merchant_order_id;
  if not found then raise exception 'merchant_order_not_found'; end if;
  if v_order.customer_id <> auth.uid()
     and not private.can_process_store_orders(v_order.store_id) then
    raise exception 'not_authorized';
  end if;
  return query
    select e.*
    from public.merchant_order_tracking_events e
    where e.merchant_order_id = _merchant_order_id
    order by e.created_at asc, e.id asc;
end;
$function$;

revoke all on function public.fetch_merchant_order_tracking(uuid) from public, anon;
grant execute on function public.fetch_merchant_order_tracking(uuid) to authenticated;