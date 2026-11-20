drop policy if exists "Stores browsing country and owner read" on public.stores;
create policy "Stores browsing country owner and team read"
on public.stores for select to authenticated
using (
  owner_id = (select auth.uid())
  or (select private.is_store_team_member(id))
  or exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid())
      and p.browsing_country_code = stores.country_code
  )
);