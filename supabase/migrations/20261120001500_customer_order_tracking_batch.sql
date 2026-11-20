create or replace function public.fetch_customer_order_tracking(_merchant_order_ids uuid[])
returns table (
  merchant_order_id uuid,
  id uuid,
  status text,
  note text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_authorized_count integer;
  v_requested_count integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if _merchant_order_ids is null then
    raise exception 'invalid_merchant_order_ids';
  end if;

  v_requested_count := cardinality(_merchant_order_ids);
  if v_requested_count > 100 then
    raise exception 'too_many_merchant_orders';
  end if;

  if v_requested_count = 0 then
    return;
  end if;

  select count(*)::integer
  into v_authorized_count
  from public.merchant_orders mo
  where mo.id = any(_merchant_order_ids)
    and mo.customer_id = auth.uid();

  if v_authorized_count <> v_requested_count then
    raise exception 'not_authorized';
  end if;

  return query
  select
    e.merchant_order_id,
    e.id,
    e.status,
    e.note,
    e.created_at
  from public.merchant_order_tracking_events e
  where e.merchant_order_id = any(_merchant_order_ids)
  order by e.merchant_order_id, e.created_at asc, e.id asc;
end;
$function$;

revoke all on function public.fetch_customer_order_tracking(uuid[]) from public, anon;
grant execute on function public.fetch_customer_order_tracking(uuid[]) to authenticated;
