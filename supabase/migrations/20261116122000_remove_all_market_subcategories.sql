-- Move product category references to their parent categories, clear store
-- subcategory selections, then remove all 14 child categories.
-- The product metadata guard is disabled only for this controlled data migration
-- and is re-enabled before the transaction completes.

do $$
begin
  if (select count(*) from public.categories where parent_id is null) <> 5 then
    raise exception 'Expected five root categories; aborting subcategory removal';
  end if;

  if (select count(*) from public.categories where parent_id is not null) <> 14 then
    raise exception 'Expected 14 subcategories; aborting to avoid deleting an unexpected taxonomy';
  end if;

  if exists (
    select 1
    from public.products p
    join public.categories c on c.id = p.category
    where c.parent_id is null
  ) then
    -- Root-category product references are valid and remain unchanged.
    null;
  end if;
end
$$;

alter table public.products disable trigger guard_merchant_product_metadata_update;

update public.products p
set category = c.parent_id
from public.categories c
where p.category = c.id
  and c.parent_id is not null;

alter table public.products enable trigger guard_merchant_product_metadata_update;

update public.stores s
set subcategories = coalesce(
  (
    select array_agg(selected_id)
    from unnest(coalesce(s.subcategories, '{}'::text[])) as selected_id
    where not exists (
      select 1
      from public.categories c
      where c.id = selected_id
        and c.parent_id is not null
    )
  ),
  '{}'::text[]
)
where exists (
  select 1
  from unnest(coalesce(s.subcategories, '{}'::text[])) as selected_id
  join public.categories c
    on c.id = selected_id
   and c.parent_id is not null
);

delete from public.categories
where parent_id is not null;

do $$
begin
  if (select count(*) from public.categories) <> 5
     or exists (select 1 from public.categories where parent_id is not null) then
    raise exception 'Verification failed: expected exactly five root categories and no subcategories';
  end if;

  if exists (
    select 1 from public.products p
    where p.category in (
      'makeup', 'perfumes', 'skincare',
      'computers', 'gadgets', 'phone-accessories', 'phones',
      'bags', 'clothes', 'shoes',
      'decor', 'furniture', 'home-tools', 'kitchenware'
    )
  ) then
    raise exception 'Verification failed: products still reference removed subcategories';
  end if;

  if exists (
    select 1
    from public.stores s,
         unnest(coalesce(s.subcategories, '{}'::text[])) as selected_id
    where selected_id in (
      'makeup', 'perfumes', 'skincare',
      'computers', 'gadgets', 'phone-accessories', 'phones',
      'bags', 'clothes', 'shoes',
      'decor', 'furniture', 'home-tools', 'kitchenware'
    )
  ) then
    raise exception 'Verification failed: stores still reference removed subcategories';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'products'
      and t.tgname = 'guard_merchant_product_metadata_update'
      and t.tgenabled = 'O'
      and not t.tgisinternal
  ) then
    raise exception 'Verification failed: merchant product metadata guard is not enabled';
  end if;
end
$$;
