drop policy if exists "Offers browsing country and store team read" on public.store_offers;
create policy "Offers browsing country and store team read"
on public.store_offers for select to authenticated
using (
  exists (select 1 from public.stores s where s.id=store_offers.store_id and s.owner_id=(select auth.uid()))
  or (select private.is_store_team_member(store_offers.store_id))
  or exists (
    select 1 from public.stores s join public.profiles p on p.user_id=(select auth.uid())
    where s.id=store_offers.store_id and p.browsing_country_code=s.country_code
  )
);

drop policy if exists "Products creator store team and market read" on public.products;
create policy "Products creator store team and market read"
on public.products for select to authenticated
using (
  created_by=(select auth.uid())
  or exists (
    select 1 from public.store_offers so
    where so.product_id=products.id and (select private.is_store_team_member(so.store_id))
  )
  or exists (
    select 1 from public.store_offers so
    join public.stores s on s.id=so.store_id
    join public.profiles p on p.user_id=(select auth.uid())
    where so.product_id=products.id and p.browsing_country_code=s.country_code
  )
);

drop policy if exists "Images browsing country and store team read" on public.product_images;
create policy "Images browsing country and store team read"
on public.product_images for select to authenticated
using (
  exists (
    select 1 from public.store_offers so
    where so.id=product_images.offer_id and (select private.is_store_team_member(so.store_id))
  )
  or exists (
    select 1 from public.store_offers so
    join public.stores s on s.id=so.store_id
    join public.profiles p on p.user_id=(select auth.uid())
    where so.id=product_images.offer_id and p.browsing_country_code=s.country_code
  )
);