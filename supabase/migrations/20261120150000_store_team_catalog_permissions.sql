-- Store catalog permissions: Owner and Admin only. Staff remains read-only for catalog data.
create or replace function private.can_manage_store_catalog(_store_id uuid)
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

revoke all on function private.can_manage_store_catalog(uuid) from public, anon, authenticated;
grant execute on function private.can_manage_store_catalog(uuid) to authenticated;

-- Team members can read private catalog records for their store.
drop policy if exists "Offers browsing country and owner read" on public.store_offers;
create policy "Offers browsing country and store team read"
on public.store_offers for select to anon, authenticated
using (
  exists (
    select 1 from public.stores s
    where s.id = store_offers.store_id
      and s.owner_id = (select auth.uid())
  )
  or (select private.is_store_team_member(store_offers.store_id))
  or exists (
    select 1 from public.stores s
    join public.profiles p on p.user_id = (select auth.uid())
    where s.id = store_offers.store_id
      and p.browsing_country_code = s.country_code
  )
);

drop policy if exists "Products owner creator and market read" on public.products;
create policy "Products creator store team and market read"
on public.products for select to anon, authenticated
using (
  created_by = (select auth.uid())
  or exists (
    select 1 from public.store_offers so
    where so.product_id = products.id
      and (select private.is_store_team_member(so.store_id))
  )
  or exists (
    select 1 from public.store_offers so
    join public.stores s on s.id = so.store_id
    join public.profiles p on p.user_id = (select auth.uid())
    where so.product_id = products.id
      and p.browsing_country_code = s.country_code
  )
);

drop policy if exists "Images browsing country and owner read" on public.product_images;
create policy "Images browsing country and store team read"
on public.product_images for select to anon, authenticated
using (
  exists (
    select 1 from public.store_offers so
    where so.id = product_images.offer_id
      and (select private.is_store_team_member(so.store_id))
  )
  or exists (
    select 1 from public.store_offers so
    join public.stores s on s.id = so.store_id
    join public.profiles p on p.user_id = (select auth.uid())
    where so.id = product_images.offer_id
      and p.browsing_country_code = s.country_code
  )
);

drop policy if exists "Owners insert offers" on public.store_offers;
create policy "Owners and admins insert offers"
on public.store_offers for insert to authenticated
with check ((select private.can_manage_store_catalog(store_id)));

drop policy if exists "Owners update offers" on public.store_offers;
create policy "Owners and admins update offers"
on public.store_offers for update to authenticated
using ((select private.can_manage_store_catalog(store_id)))
with check ((select private.can_manage_store_catalog(store_id)));

drop policy if exists "Owners delete offers" on public.store_offers;
create policy "Owners and admins delete offers"
on public.store_offers for delete to authenticated
using ((select private.can_manage_store_catalog(store_id)));

drop policy if exists "Creators update single-offer products" on public.products;
create policy "Store admins update single-offer products"
on public.products for update to authenticated
using (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.store_offers so
    where so.product_id = products.id
      and (select private.can_manage_store_catalog(so.store_id))
  )
)
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.store_offers so
    where so.product_id = products.id
      and (select private.can_manage_store_catalog(so.store_id))
  )
);

drop policy if exists "Owners insert images" on public.product_images;
create policy "Owners and admins insert images"
on public.product_images for insert to authenticated
with check (
  exists (
    select 1 from public.store_offers so
    where so.id = product_images.offer_id
      and (select private.can_manage_store_catalog(so.store_id))
  )
);

drop policy if exists "Owners update images" on public.product_images;
create policy "Owners and admins update images"
on public.product_images for update to authenticated
using (
  exists (
    select 1 from public.store_offers so
    where so.id = product_images.offer_id
      and (select private.can_manage_store_catalog(so.store_id))
  )
)
with check (
  exists (
    select 1 from public.store_offers so
    where so.id = product_images.offer_id
      and (select private.can_manage_store_catalog(so.store_id))
  )
);

drop policy if exists "Owners delete images" on public.product_images;
create policy "Owners and admins delete images"
on public.product_images for delete to authenticated
using (
  exists (
    select 1 from public.store_offers so
    where so.id = product_images.offer_id
      and (select private.can_manage_store_catalog(so.store_id))
  )
);

-- Replace combined media policies with isolated store-media (owner) and product-media (catalog managers) policies.
drop policy if exists "Merchant media owner upload" on storage.objects;
drop policy if exists "Merchant media owner update" on storage.objects;
drop policy if exists "Merchant media owner delete" on storage.objects;

create policy "Store owners upload store media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'store-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.profiles p
    join public.user_roles ur on ur.user_id = p.user_id
    join public.stores s on s.owner_id = p.user_id
    where p.user_id = (select auth.uid())
      and p.account_type::text = 'merchant'
      and ur.role::text = 'merchant'
      and name ~ ('^' || (select auth.uid())::text || '/stores/[^/]+$')
  )
);

create policy "Store owners update store media"
on storage.objects for update to authenticated
using (
  bucket_id = 'store-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.profiles p
    join public.user_roles ur on ur.user_id = p.user_id
    join public.stores s on s.owner_id = p.user_id
    where p.user_id = (select auth.uid())
      and p.account_type::text = 'merchant'
      and ur.role::text = 'merchant'
  )
)
with check (
  bucket_id = 'store-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.profiles p
    join public.user_roles ur on ur.user_id = p.user_id
    join public.stores s on s.owner_id = p.user_id
    where p.user_id = (select auth.uid())
      and p.account_type::text = 'merchant'
      and ur.role::text = 'merchant'
  )
);

create policy "Store owners delete store media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'store-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.profiles p
    join public.user_roles ur on ur.user_id = p.user_id
    join public.stores s on s.owner_id = p.user_id
    where p.user_id = (select auth.uid())
      and p.account_type::text = 'merchant'
      and ur.role::text = 'merchant'
  )
);

create policy "Catalog managers upload product media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'product-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~ ('^' || (select auth.uid())::text || '/products/[^/]+$')
  and exists (
    select 1 from public.store_team_members m
    where m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  )
);

create policy "Catalog managers update product media"
on storage.objects for update to authenticated
using (
  bucket_id = 'product-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.store_team_members m
    where m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  )
)
with check (
  bucket_id = 'product-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.store_team_members m
    where m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  )
);

create policy "Catalog managers delete product media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'product-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.store_team_members m
    where m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  )
);

-- Product creation is a narrowly validated privileged operation, not a direct table write.
create or replace function public.create_merchant_product_offer(
  _store_id uuid, _name text, _price integer, _stock_quantity integer,
  _category text, _brand text default null, _description text default null,
  _options jsonb default '{}'::jsonb, _images jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
 actor_id uuid := auth.uid();
 created_product_id uuid;
 created_offer_id uuid;
 image_item jsonb;
 image_path text;
 image_url text;
 image_suffix text;
begin
 if actor_id is null then raise exception 'not_authenticated'; end if;
 if not private.can_manage_store_catalog(_store_id) then raise exception 'not_authorized'; end if;
 if nullif(btrim(_name),'') is null or char_length(btrim(_name))>120
  or _price is null or _price<=0 or _stock_quantity is null or _stock_quantity<0 or _stock_quantity>9999
  or _category is null or char_length(coalesce(_brand,''))>80 or char_length(coalesce(_description,''))>3000
 then raise exception 'invalid_merchant_product_input'; end if;
 if not exists(select 1 from public.categories c where c.id=_category and c.is_active=true) then
  raise exception 'invalid_merchant_product_category';
 end if;
 if _options is null or jsonb_typeof(_options)<>'object'
  or exists(select 1 from jsonb_object_keys(_options) as k(key) where k.key not in ('sizes','colors'))
  or (_options ? 'sizes' and jsonb_typeof(_options->'sizes')<>'array')
  or (_options ? 'colors' and jsonb_typeof(_options->'colors')<>'array')
  or coalesce(jsonb_array_length(case when jsonb_typeof(_options->'sizes')='array' then _options->'sizes' else '[]'::jsonb end),0)>20
  or coalesce(jsonb_array_length(case when jsonb_typeof(_options->'colors')='array' then _options->'colors' else '[]'::jsonb end),0)>20
 then raise exception 'invalid_merchant_product_options'; end if;
 if exists(
  select 1 from jsonb_array_elements(case when jsonb_typeof(_options->'sizes')='array' then _options->'sizes' else '[]'::jsonb end) item
  where jsonb_typeof(item)<>'string' or char_length(btrim(item#>>'{}'))=0 or char_length(btrim(item#>>'{}'))>40
 ) or exists(
  select 1 from jsonb_array_elements(case when jsonb_typeof(_options->'colors')='array' then _options->'colors' else '[]'::jsonb end) item
  where jsonb_typeof(item)<>'string' or char_length(btrim(item#>>'{}'))=0 or char_length(btrim(item#>>'{}'))>40
 ) then raise exception 'invalid_merchant_product_options'; end if;
 if _images is null or jsonb_typeof(_images)<>'array' or jsonb_array_length(_images)>5 then
  raise exception 'invalid_merchant_product_images';
 end if;
 for image_item in select value from jsonb_array_elements(_images)
 loop
  image_path:=image_item->>'path';
  image_url:=image_item->>'url';
  image_suffix:='/storage/v1/object/public/product-media/'||image_path;
  if jsonb_typeof(image_item)<>'object' or image_path is null
   or image_path not like actor_id::text||'/products/%'
   or image_url is null or image_url not like 'https://%'
   or right(image_url,char_length(image_suffix))<>image_suffix
   or not exists(select 1 from storage.objects o where o.bucket_id='product-media' and o.name=image_path)
  then raise exception 'invalid_merchant_product_image'; end if;
 end loop;
 insert into public.products(name,description,brand,category,created_by)
 values(btrim(_name),nullif(btrim(coalesce(_description,'')),''),nullif(btrim(coalesce(_brand,'')),''),_category,actor_id)
 returning id into created_product_id;
 insert into public.store_offers(store_id,product_id,price,stock_quantity,options)
 values(_store_id,created_product_id,_price,_stock_quantity,coalesce(_options,'{}'::jsonb))
 returning id into created_offer_id;
 insert into public.product_images(offer_id,image_url,is_primary)
 select created_offer_id,item.value->>'url',item.ordinality=1
 from jsonb_array_elements(_images) with ordinality as item(value,ordinality);
 return created_offer_id;
end;
$function$;

create or replace function public.update_merchant_product_details(
 _offer_id uuid, _store_id uuid, _name text, _description text, _brand text, _category text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
 actor_id uuid := auth.uid();
 target_product_id uuid;
 offer_count bigint;
begin
 if actor_id is null then raise exception 'not_authenticated'; end if;
 if not private.can_manage_store_catalog(_store_id) then raise exception 'not_authorized'; end if;
 if _offer_id is null or _store_id is null or nullif(btrim(_name),'') is null
  or char_length(btrim(_name))>120 or char_length(coalesce(_brand,''))>80
  or char_length(coalesce(_description,''))>3000 or _category is null
 then raise exception 'invalid_merchant_product_details'; end if;
 if not exists(select 1 from public.categories c where c.id=_category and c.is_active=true) then
  raise exception 'invalid_merchant_product_category'; end if;
 select p.id into target_product_id
 from public.products p join public.store_offers so on so.product_id=p.id
 where so.id=_offer_id and so.store_id=_store_id
 for update of p;
 if target_product_id is null then raise exception 'merchant_product_not_editable'; end if;
 select count(*) into offer_count from public.store_offers so where so.product_id=target_product_id;
 if offer_count<>1 then raise exception 'merchant_product_shared'; end if;
 update public.products p set name=btrim(_name),
  description=nullif(btrim(coalesce(_description,'')),''),
  brand=nullif(btrim(coalesce(_brand,'')),''),
  category=_category
 where p.id=target_product_id
 returning p.id into target_product_id;
 if target_product_id is null then raise exception 'merchant_product_not_updated'; end if;
 return target_product_id;
end;
$function$;

create or replace function public.add_merchant_product_image(_offer_id uuid, _image_path text, _image_url text)
returns table(id uuid, image_url text, is_primary boolean)
language plpgsql
security definer
set search_path = ''
as $function$
declare
 actor_id uuid := auth.uid();
 image_id uuid;
 primary_value boolean;
 target_store_id uuid;
begin
 if actor_id is null then raise exception 'not_authenticated'; end if;
 select so.store_id into target_store_id from public.store_offers so where so.id=_offer_id;
 if target_store_id is null or not private.can_manage_store_catalog(target_store_id) then
  raise exception 'merchant_offer_not_found';
 end if;
 if _image_path !~ ('^' || actor_id::text || '/products/[^/]+$')
  or _image_url not like '%/storage/v1/object/public/product-media/' || _image_path then
  raise exception 'invalid_product_image_path';
 end if;
 if not exists(select 1 from storage.objects so where so.bucket_id='product-media' and so.name=_image_path) then
  raise exception 'product_image_storage_object_not_found';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(_offer_id::text,0));
 if (select count(*) from public.product_images pi where pi.offer_id=_offer_id)>=5 then
  raise exception 'product_image_limit_reached';
 end if;
 select not exists(select 1 from public.product_images pi where pi.offer_id=_offer_id and pi.is_primary)
 into primary_value;
 insert into public.product_images(offer_id,image_url,is_primary)
 values(_offer_id,_image_url,primary_value) returning product_images.id into image_id;
 return query select pi.id,pi.image_url,pi.is_primary from public.product_images pi where pi.id=image_id;
end;
$function$;

create or replace function public.remove_merchant_product_image(_offer_id uuid, _image_id uuid)
returns table(id uuid, image_url text, is_primary boolean)
language plpgsql
security definer
set search_path = ''
as $function$
declare
 actor_id uuid := auth.uid();
 removed public.product_images;
 target_store_id uuid;
begin
 if actor_id is null then raise exception 'not_authenticated'; end if;
 select so.store_id into target_store_id from public.store_offers so where so.id=_offer_id;
 if target_store_id is null or not private.can_manage_store_catalog(target_store_id) then
  raise exception 'merchant_offer_not_found';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(_offer_id::text,0));
 delete from public.product_images pi where pi.id=_image_id and pi.offer_id=_offer_id
 returning pi.* into removed;
 if removed.id is null then raise exception 'merchant_product_image_not_found'; end if;
 if removed.is_primary then
  update public.product_images pi set is_primary=true
  where pi.id=(
   select next_image.id from public.product_images next_image
   where next_image.offer_id=_offer_id
   order by next_image.created_at asc,next_image.id asc limit 1
  );
 end if;
 return query select removed.id,removed.image_url,removed.is_primary;
end;
$function$;

-- Narrow offer mutation API. No arbitrary columns can be changed by Admin.
create or replace function public.update_merchant_product_offer(
 _offer_id uuid, _store_id uuid, _price integer, _stock_quantity integer,
 _options jsonb default null, _is_merchant_hidden boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
 updated_id uuid;
begin
 if auth.uid() is null then raise exception 'not_authenticated'; end if;
 if not private.can_manage_store_catalog(_store_id) then raise exception 'not_authorized'; end if;
 if _price is null or _price<=0 or _price>50000000
  or _stock_quantity is null or _stock_quantity<0 or _stock_quantity>9999 then
  raise exception 'invalid_merchant_offer_values';
 end if;
 if _options is not null and (
  jsonb_typeof(_options)<>'object'
  or exists(select 1 from jsonb_object_keys(_options) as k(key) where k.key not in ('sizes','colors'))
  or (_options ? 'sizes' and jsonb_typeof(_options->'sizes')<>'array')
  or (_options ? 'colors' and jsonb_typeof(_options->'colors')<>'array')
  or coalesce(jsonb_array_length(case when jsonb_typeof(_options->'sizes')='array' then _options->'sizes' else '[]'::jsonb end),0)>20
  or coalesce(jsonb_array_length(case when jsonb_typeof(_options->'colors')='array' then _options->'colors' else '[]'::jsonb end),0)>20
 ) then raise exception 'invalid_merchant_product_options'; end if;
 update public.store_offers so
 set price=_price,stock_quantity=_stock_quantity,
  options=coalesce(_options,so.options),
  is_merchant_hidden=coalesce(_is_merchant_hidden,so.is_merchant_hidden),
  last_confirmed_at=now()
 where so.id=_offer_id and so.store_id=_store_id
 returning so.id into updated_id;
 if updated_id is null then raise exception 'merchant_offer_not_updated'; end if;
 return updated_id;
end;
$function$;

revoke all on function public.create_merchant_product_offer(uuid,text,integer,integer,text,text,text,jsonb,jsonb) from public,anon;
revoke all on function public.update_merchant_product_details(uuid,uuid,text,text,text,text) from public,anon;
revoke all on function public.add_merchant_product_image(uuid,text,text) from public,anon;
revoke all on function public.remove_merchant_product_image(uuid,uuid) from public,anon;
revoke all on function public.update_merchant_product_offer(uuid,uuid,integer,integer,jsonb,boolean) from public,anon;
grant execute on function public.create_merchant_product_offer(uuid,text,integer,integer,text,text,text,jsonb,jsonb) to authenticated;
grant execute on function public.update_merchant_product_details(uuid,uuid,text,text,text,text) to authenticated;
grant execute on function public.add_merchant_product_image(uuid,text,text) to authenticated;
grant execute on function public.remove_merchant_product_image(uuid,uuid) to authenticated;
grant execute on function public.update_merchant_product_offer(uuid,uuid,integer,integer,jsonb,boolean) to authenticated;
