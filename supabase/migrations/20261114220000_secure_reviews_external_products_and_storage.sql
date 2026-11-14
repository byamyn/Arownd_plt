-- Secure verified reviews, external product provider usage, direct table writes and merchant media storage.
-- This migration is staged in GitHub only. It is not applied to the production database.

create or replace function public.submit_review(
  _target_type review_target_type,
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
  values (actor_id, _target_type, _target_id, _rating, normalized_comment, 'approved')
  on conflict (user_id, target_type, target_id)
  do update set
    rating = excluded.rating,
    comment = excluded.comment,
    status = 'approved',
    updated_at = now()
  returning * into review_row;

  return review_row;
end;
$function$;

-- Private-to-service cache. No client role receives access to these tables.
create table if not exists public.external_products_cache (
  market text not null,
  language text not null,
  products jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (market, language),
  constraint external_products_cache_market_check check (market in ('ae', 'eg', 'ma')),
  constraint external_products_cache_language_check check (language in ('ar', 'en'))
);

create table if not exists public.external_products_rate_limits (
  user_id uuid not null,
  hour_bucket timestamptz not null,
  request_count integer not null default 0,
  primary key (user_id, hour_bucket),
  constraint external_products_rate_limits_count_check check (request_count >= 0)
);

alter table public.external_products_cache enable row level security;
alter table public.external_products_rate_limits enable row level security;
revoke all on public.external_products_cache from anon, authenticated;
revoke all on public.external_products_rate_limits from anon, authenticated;
grant select, insert, update, delete on public.external_products_cache to service_role;
grant select, insert, update, delete on public.external_products_rate_limits to service_role;

create or replace function public.consume_external_products_quota(_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_bucket timestamptz := date_trunc('hour', now());
  current_count integer;
begin
  if _user_id is null then return false; end if;

  delete from public.external_products_rate_limits
  where user_id = _user_id
    and hour_bucket < current_bucket - interval '2 hours';

  insert into public.external_products_rate_limits (user_id, hour_bucket, request_count)
  values (_user_id, current_bucket, 1)
  on conflict (user_id, hour_bucket)
  do update set request_count = public.external_products_rate_limits.request_count + 1
  returning request_count into current_count;

  return current_count <= 10;
end;
$function$;

revoke all on function public.consume_external_products_quota(uuid) from public, anon, authenticated;
grant execute on function public.consume_external_products_quota(uuid) to service_role;

-- Product-image mutations must go through owner-checked RPCs once direct DML is revoked.
create or replace function public.add_merchant_product_image(
  _offer_id uuid,
  _image_path text,
  _image_url text
)
returns table(id uuid, image_url text, is_primary boolean)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  image_id uuid;
  primary_value boolean;
begin
  if actor_id is null then raise exception 'not_authenticated'; end if;
  if _image_path !~ ('^' || actor_id::text || '/products/[^/]+$')
     or _image_url not like '%/storage/v1/object/public/product-media/' || _image_path then
    raise exception 'invalid_product_image_path';
  end if;

  if not exists (
    select 1 from public.store_offers so
    join public.stores st on st.id = so.store_id
    where so.id = _offer_id and st.owner_id = actor_id
      and exists (
        select 1 from public.profiles p
        join public.user_roles ur on ur.user_id = p.user_id
        where p.user_id = actor_id
          and p.account_type::text = 'merchant'
          and ur.role::text = 'merchant'
      )
  ) then
    raise exception 'merchant_offer_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(_offer_id::text, 0));
  if (select count(*) from public.product_images pi where pi.offer_id = _offer_id) >= 5 then
    raise exception 'product_image_limit_reached';
  end if;

  select not exists (
    select 1 from public.product_images pi
    where pi.offer_id = _offer_id and pi.is_primary
  ) into primary_value;

  insert into public.product_images (offer_id, image_url, is_primary)
  values (_offer_id, _image_url, primary_value)
  returning product_images.id into image_id;

  return query
  select pi.id, pi.image_url, pi.is_primary
  from public.product_images pi where pi.id = image_id;
end;
$function$;

create or replace function public.remove_merchant_product_image(
  _offer_id uuid,
  _image_id uuid
)
returns table(id uuid, image_url text, is_primary boolean)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  removed public.product_images;
begin
  if actor_id is null then raise exception 'not_authenticated'; end if;
  if not exists (
    select 1 from public.store_offers so
    join public.stores st on st.id = so.store_id
    where so.id = _offer_id and st.owner_id = actor_id
      and exists (
        select 1 from public.profiles p
        join public.user_roles ur on ur.user_id = p.user_id
        where p.user_id = actor_id
          and p.account_type::text = 'merchant'
          and ur.role::text = 'merchant'
      )
  ) then
    raise exception 'merchant_offer_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(_offer_id::text, 0));

  delete from public.product_images pi
  where pi.id = _image_id and pi.offer_id = _offer_id
  returning pi.* into removed;

  if removed.id is null then raise exception 'merchant_product_image_not_found'; end if;

  if removed.is_primary then
    update public.product_images pi
    set is_primary = true
    where pi.id = (
      select next_image.id
      from public.product_images next_image
      where next_image.offer_id = _offer_id
      order by next_image.created_at asc, next_image.id asc
      limit 1
    );
  end if;

  return query select removed.id, removed.image_url, removed.is_primary;
end;
$function$;

revoke all on function public.add_merchant_product_image(uuid, text, text) from public, anon;
revoke all on function public.remove_merchant_product_image(uuid, uuid) from public, anon;
grant execute on function public.add_merchant_product_image(uuid, text, text) to authenticated;
grant execute on function public.remove_merchant_product_image(uuid, uuid) to authenticated;

-- The mobile app only reads these tables directly; writes are performed by trusted RPCs.
revoke insert, update, delete on public.categories, public.countries, public.wilayas,
  public.country_regions, public.order_items, public.reservations from anon, authenticated;
revoke insert, update, delete on public.product_images from anon, authenticated;
grant select on public.product_images to authenticated;

-- Remove listing access to public media objects. Public buckets remain directly readable by URL.
drop policy if exists "Media public read" on storage.objects;
drop policy if exists "Media owner upload" on storage.objects;
drop policy if exists "Media owner update" on storage.objects;
drop policy if exists "Media owner delete" on storage.objects;

create policy "Merchant media owner read"
on storage.objects for select to authenticated
using (
  bucket_id in ('store-media', 'product-media')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Merchant media owner upload"
on storage.objects for insert to authenticated
with check (
  bucket_id in ('store-media', 'product-media')
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.user_id
    join public.stores s on s.owner_id = p.user_id
    where p.user_id = (select auth.uid())
      and p.account_type::text = 'merchant'
      and ur.role::text = 'merchant'
  )
  and (
    (bucket_id = 'store-media' and name ~ ('^' || (select auth.uid())::text || '/stores/[^/]+$'))
    or
    (bucket_id = 'product-media' and name ~ ('^' || (select auth.uid())::text || '/products/[^/]+$'))
  )
);

create policy "Merchant media owner update"
on storage.objects for update to authenticated
using (
  bucket_id in ('store-media', 'product-media')
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.profiles p
    join public.user_roles ur on ur.user_id = p.user_id
    join public.stores s on s.owner_id = p.user_id
    where p.user_id = (select auth.uid())
      and p.account_type::text = 'merchant' and ur.role::text = 'merchant'
  )
)
with check (
  bucket_id in ('store-media', 'product-media')
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.profiles p
    join public.user_roles ur on ur.user_id = p.user_id
    join public.stores s on s.owner_id = p.user_id
    where p.user_id = (select auth.uid())
      and p.account_type::text = 'merchant' and ur.role::text = 'merchant'
  )
);

create policy "Merchant media owner delete"
on storage.objects for delete to authenticated
using (
  bucket_id in ('store-media', 'product-media')
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.profiles p
    join public.user_roles ur on ur.user_id = p.user_id
    join public.stores s on s.owner_id = p.user_id
    where p.user_id = (select auth.uid())
      and p.account_type::text = 'merchant' and ur.role::text = 'merchant'
  )
);

create or replace function public.enforce_merchant_media_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid;
  new_size bigint;
  used_bytes bigint;
begin
  if new.bucket_id not in ('store-media', 'product-media') then return new; end if;

  if split_part(new.name, '/', 1) !~ '^[0-9a-fA-F-]{36}$' then
    raise exception 'invalid_merchant_media_path';
  end if;
  actor_id := split_part(new.name, '/', 1)::uuid;

  if not exists (
    select 1
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.user_id
    join public.stores s on s.owner_id = p.user_id
    where p.user_id = actor_id
      and p.account_type::text = 'merchant'
      and ur.role::text = 'merchant'
  ) then
    raise exception 'merchant_media_upload_not_allowed';
  end if;

  if (new.bucket_id = 'store-media' and new.name !~ ('^' || actor_id::text || '/stores/[^/]+$'))
     or (new.bucket_id = 'product-media' and new.name !~ ('^' || actor_id::text || '/products/[^/]+$')) then
    raise exception 'invalid_merchant_media_path';
  end if;

  new_size := nullif(new.metadata->>'size', '')::bigint;
  if new_size is null or new_size <= 0 then raise exception 'invalid_merchant_media_size'; end if;

  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));

  select coalesce(sum(nullif(o.metadata->>'size', '')::bigint), 0)
  into used_bytes
  from storage.objects o
  where o.bucket_id in ('store-media', 'product-media')
    and split_part(o.name, '/', 1) = actor_id::text
    and o.id is distinct from new.id;

  if used_bytes + new_size > 104857600 then
    raise exception 'merchant_media_quota_exceeded';
  end if;

  return new;
end;
$function$;

drop trigger if exists enforce_merchant_media_quota on storage.objects;
create trigger enforce_merchant_media_quota
before insert or update of bucket_id, name, metadata
on storage.objects
for each row execute function public.enforce_merchant_media_quota();

revoke all on function public.enforce_merchant_media_quota() from public, anon, authenticated;
