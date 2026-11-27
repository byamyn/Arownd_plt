alter table public.merchant_orders
  add column if not exists delivered_at timestamptz,
  add column if not exists delivered_at_is_estimated boolean not null default false;

-- Restore historical delivery timestamps from immutable tracking events first.
update public.merchant_orders mo
set delivered_at = coalesce(
      (
        select min(e.created_at)
        from public.merchant_order_tracking_events e
        where e.merchant_order_id = mo.id
          and e.status = 'delivered'
      ),
      (
        select min(l.created_at)
        from public.shipments sh
        join public.shipment_status_logs l on l.shipment_id = sh.id
        where sh.merchant_order_id = mo.id
          and l.status = 'delivered'
      ),
      mo.updated_at
    ),
    delivered_at_is_estimated = not (
      exists (
        select 1 from public.merchant_order_tracking_events e
        where e.merchant_order_id = mo.id and e.status = 'delivered'
      )
      or exists (
        select 1
        from public.shipments sh
        join public.shipment_status_logs l on l.shipment_id = sh.id
        where sh.merchant_order_id = mo.id and l.status = 'delivered'
      )
    )
where mo.status = 'delivered'
  and mo.delivered_at is null;

create index if not exists merchant_orders_store_delivered_at_idx
  on public.merchant_orders (store_id, delivered_at desc)
  where status = 'delivered';

create or replace function public.set_merchant_order_delivered_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.status = 'delivered'
     and (tg_op = 'INSERT' or old.status is distinct from 'delivered') then
    new.delivered_at := now();
    new.delivered_at_is_estimated := false;
  end if;
  return new;
end;
$function$;

drop trigger if exists merchant_order_set_delivered_at on public.merchant_orders;
create trigger merchant_order_set_delivered_at
before insert or update of status on public.merchant_orders
for each row execute function public.set_merchant_order_delivered_at();

create or replace function public.get_my_store_business_analytics(
  _store_id uuid,
  _period text default '30d',
  _from_date date default null,
  _to_date date default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_from date;
  v_to date;
  v_previous_from date;
  v_previous_to date;
  v_days integer;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if not private.can_manage_store_orders(_store_id) then
    raise exception 'merchant_store_not_found';
  end if;

  if _period = 'custom' then
    if _from_date is null or _to_date is null or _from_date > _to_date
       or (_to_date - _from_date) > 364 then
      raise exception 'invalid_analytics_date_range';
    end if;
    v_from := _from_date;
    v_to := _to_date;
  elsif _period in ('7d', '30d', '90d') then
    v_days := case _period when '7d' then 7 when '30d' then 30 else 90 end;
    v_to := current_date;
    v_from := v_to - (v_days - 1);
  else
    raise exception 'invalid_analytics_period';
  end if;

  v_days := (v_to - v_from) + 1;
  v_previous_to := v_from - 1;
  v_previous_from := v_previous_to - (v_days - 1);

  with
  period_orders as (
    select mo.*
    from public.merchant_orders mo
    where mo.store_id = _store_id
      and mo.created_at >= v_from::timestamptz
      and mo.created_at < (v_to + 1)::timestamptz
  ),
  delivered_period as (
    select mo.*
    from public.merchant_orders mo
    where mo.store_id = _store_id
      and mo.status = 'delivered'
      and mo.delivered_at >= v_from::timestamptz
      and mo.delivered_at < (v_to + 1)::timestamptz
  ),
  previous_delivered as (
    select mo.*
    from public.merchant_orders mo
    where mo.store_id = _store_id
      and mo.status = 'delivered'
      and mo.delivered_at >= v_previous_from::timestamptz
      and mo.delivered_at < (v_previous_to + 1)::timestamptz
  ),
  order_stats as (
    select
      count(*)::bigint as orders_total,
      count(*) filter (where status = 'delivered')::bigint as delivered_orders,
      count(*) filter (where status in ('pending','quoted','confirmed','shipped'))::bigint as active_orders,
      count(*) filter (where status = 'cancelled')::bigint as cancelled_orders,
      count(*) filter (where status = 'rejected')::bigint as rejected_orders
    from period_orders
  ),
  sales_stats as (
    select
      coalesce(sum(subtotal), 0)::numeric as revenue,
      count(*)::bigint as delivered_orders,
      coalesce(round(avg(subtotal)), 0)::numeric as average_order,
      count(*) filter (where delivered_at_is_estimated)::bigint as estimated_delivery_dates
    from delivered_period
  ),
  previous_sales as (
    select coalesce(sum(subtotal), 0)::numeric as revenue
    from previous_delivered
  ),
  daily_sales as (
    select d.day::date as day,
           coalesce(sum(mo.subtotal), 0)::numeric as amount
    from generate_series(v_from::timestamp, v_to::timestamp, interval '1 day') d(day)
    left join delivered_period mo on mo.delivered_at >= d.day
      and mo.delivered_at < d.day + interval '1 day'
    group by d.day
  ),
  product_sales as (
    select
      oi.product_name,
      oi.offer_id,
      sum(oi.quantity)::bigint as units_sold,
      sum(oi.unit_price * oi.quantity)::numeric as revenue
    from public.order_items oi
    join delivered_period mo on mo.id = oi.merchant_order_id
    group by oi.product_name, oi.offer_id
  ),
  top_products as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', ranked.product_name,
      'units_sold', ranked.units_sold,
      'revenue', ranked.revenue
    ) order by ranked.units_sold desc, ranked.revenue desc), '[]'::jsonb) as items
    from (
      select product_name, units_sold, revenue
      from product_sales
      order by units_sold desc, revenue desc
      limit 5
    ) ranked
  ),
  slow_products as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', p.name,
      'stock_quantity', so.stock_quantity
    ) order by so.stock_quantity asc, p.name), '[]'::jsonb) as items
    from public.store_offers so
    join public.products p on p.id = so.product_id
    where so.store_id = _store_id
      and not exists (
        select 1 from product_sales ps where ps.offer_id = so.id
      )
  ),
  inventory as (
    select
      count(*)::bigint as product_count,
      count(*) filter (where stock_quantity between 1 and 3)::bigint as low_stock_count,
      count(*) filter (where stock_quantity = 0)::bigint as out_of_stock_count
    from public.store_offers
    where store_id = _store_id
  )
  select jsonb_build_object(
    'period', _period,
    'from_date', v_from,
    'to_date', v_to,
    'previous_from_date', v_previous_from,
    'previous_to_date', v_previous_to,
    'revenue', ss.revenue,
    'previous_revenue', ps.revenue,
    'revenue_change_percent', case
      when ps.revenue = 0 then null
      else round(((ss.revenue - ps.revenue) / ps.revenue) * 100, 1)
    end,
    'orders_total', os.orders_total,
    'delivered_orders', os.delivered_orders,
    'active_orders', os.active_orders,
    'cancelled_orders', os.cancelled_orders,
    'rejected_orders', os.rejected_orders,
    'average_order', ss.average_order,
    'delivery_rate_percent', case when os.orders_total = 0 then 0
      else round((ss.delivered_orders::numeric / os.orders_total) * 100, 1) end,
    'cancellation_rate_percent', case when os.orders_total = 0 then 0
      else round((os.cancelled_orders::numeric / os.orders_total) * 100, 1) end,
    'estimated_delivery_dates', ss.estimated_delivery_dates,
    'daily_sales', (select coalesce(jsonb_agg(jsonb_build_object(
      'day', day, 'amount', amount
    ) order by day), '[]'::jsonb) from daily_sales),
    'top_products', tp.items,
    'slow_products', sp.items,
    'product_count', inv.product_count,
    'low_stock_count', inv.low_stock_count,
    'out_of_stock_count', inv.out_of_stock_count
  )
  into v_result
  from order_stats os
  cross join sales_stats ss
  cross join previous_sales ps
  cross join top_products tp
  cross join slow_products sp
  cross join inventory inv;

  return v_result;
end;
$function$;

revoke all on function public.get_my_store_business_analytics(uuid, text, date, date) from public, anon;
grant execute on function public.get_my_store_business_analytics(uuid, text, date, date) to authenticated;
