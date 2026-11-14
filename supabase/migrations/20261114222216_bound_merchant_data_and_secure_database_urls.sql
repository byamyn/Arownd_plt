-- Bound merchant-controlled values, constrain store image origins, and reduce database HTTP privileges.
begin;

alter table public.stores
  add constraint stores_description_length_check
  check (char_length(coalesce(description, '')) <= 2000),
  add constraint stores_logo_url_storage_only_check
  check (
    logo_url is null
    or logo_url ~ '^https://nagzoafkitfsqlcwsdau\.supabase\.co/storage/v1/object/(public|sign)/store-media/[A-Za-z0-9._~/-]+(\?token=[A-Za-z0-9._-]+)?$'
  ),
  add constraint stores_cover_url_storage_only_check
  check (
    cover_url is null
    or cover_url ~ '^https://nagzoafkitfsqlcwsdau\.supabase\.co/storage/v1/object/(public|sign)/store-media/[A-Za-z0-9._~/-]+(\?token=[A-Za-z0-9._-]+)?$'
  ),
  add constraint stores_facebook_https_url_check
  check (
    facebook_url is null
    or (
      char_length(facebook_url) <= 300
      and facebook_url ~ '^https://[^/?#[:space:]]+([/?#][^[:space:]]*)?$'
    )
  ),
  add constraint stores_instagram_https_url_check
  check (
    instagram_url is null
    or (
      char_length(instagram_url) <= 300
      and instagram_url ~ '^https://[^/?#[:space:]]+([/?#][^[:space:]]*)?$'
    )
  );

alter table public.products
  add constraint products_description_length_check
  check (char_length(coalesce(description, '')) <= 3000),
  add constraint products_brand_length_check
  check (char_length(coalesce(brand, '')) <= 80),
  add constraint products_name_length_check
  check (char_length(name) between 1 and 120);

alter table public.store_offers
  drop constraint store_offers_price_check,
  add constraint store_offers_price_check
  check (price between 0 and 50000000),
  add constraint store_offers_old_price_range_check
  check (old_price is null or old_price between 0 and 50000000),
  drop constraint store_offers_stock_quantity_check,
  add constraint store_offers_stock_quantity_check
  check (stock_quantity between 0 and 9999),
  add constraint store_offers_options_size_check
  check (
    pg_column_size(coalesce(options, '{}'::jsonb)) <= 8192
    and jsonb_typeof(coalesce(options, '{}'::jsonb)) = 'object'
    and (coalesce(options, '{}'::jsonb) - 'sizes' - 'colors') = '{}'::jsonb
    and (
      not (coalesce(options, '{}'::jsonb) ? 'sizes')
      or (
        jsonb_typeof(options -> 'sizes') = 'array'
        and jsonb_array_length(
          case when jsonb_typeof(options -> 'sizes') = 'array'
            then options -> 'sizes' else '[]'::jsonb end
        ) <= 20
      )
    )
    and (
      not (coalesce(options, '{}'::jsonb) ? 'colors')
      or (
        jsonb_typeof(options -> 'colors') = 'array'
        and jsonb_array_length(
          case when jsonb_typeof(options -> 'colors') = 'array'
            then options -> 'colors' else '[]'::jsonb end
        ) <= 20
      )
    )
  );

-- The notification trigger runs as this function's postgres owner.
revoke execute on function net.http_post(text, jsonb, jsonb, jsonb, integer)
  from public, anon, authenticated;

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
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

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

  if not found then
    raise exception 'merchant_order_not_found';
  end if;

  select * into mo
  from public.merchant_orders
  where id = _merchant_order_id
  for update;

  if not private.is_store_owner(mo.store_id) then
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

commit;
