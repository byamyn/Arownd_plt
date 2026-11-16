-- Keep the five approved marketplace categories and their existing children.
-- Preserve stable category IDs so product and store references remain valid.

do $$
begin
  if (select count(*) from public.categories where parent_id is null and id in ('fashion', 'electronics', 'beauty', 'home', 'misc')) <> 5 then
    raise exception 'Expected all five retained root categories to exist; aborting taxonomy cleanup';
  end if;

  if exists (
    select 1
    from public.stores
    where (category is not null and category not in ('fashion', 'electronics', 'beauty', 'home', 'misc'))
       or exists (
         select 1
         from unnest(coalesce(subcategories, '{}'::text[])) as subcategory_id
         where subcategory_id not in (
           'clothes', 'shoes', 'bags',
           'phones', 'computers', 'gadgets', 'phone-accessories',
           'perfumes', 'makeup', 'skincare',
           'furniture', 'home-tools', 'decor', 'kitchenware'
         )
       )
  ) then
    raise exception 'A store references a category scheduled for deletion; aborting to preserve store data';
  end if;

  if exists (
    select 1
    from public.products
    where category in (
      select id
      from public.categories
      where id not in (
        'fashion', 'electronics', 'beauty', 'home', 'misc',
        'clothes', 'shoes', 'bags',
        'phones', 'computers', 'gadgets', 'phone-accessories',
        'perfumes', 'makeup', 'skincare',
        'furniture', 'home-tools', 'decor', 'kitchenware'
      )
    )
  ) then
    raise exception 'A product references a category scheduled for deletion; aborting to preserve product data';
  end if;
end
$$;

update public.categories
set label_ar = case id
  when 'fashion' then 'الأزياء والأناقة'
  when 'electronics' then 'التكنولوجيا والأجهزة الإلكترونية'
  when 'beauty' then 'الجمال والعطور والعناية'
  when 'home' then 'المنزل والأثاث والديكور'
  when 'misc' then 'مستلزمات ومنتجات متنوعة'
end
where id in ('fashion', 'electronics', 'beauty', 'home', 'misc')
  and parent_id is null;

-- parent_id uses ON DELETE CASCADE, so child rows of removed roots are removed too.
delete from public.categories
where parent_id is null
  and id not in ('fashion', 'electronics', 'beauty', 'home', 'misc');

do $$
begin
  if (select count(*) from public.categories) <> 19 then
    raise exception 'Taxonomy cleanup verification failed: expected exactly 19 remaining categories';
  end if;

  if (select count(*) from public.categories where parent_id is null) <> 5 then
    raise exception 'Taxonomy cleanup verification failed: expected exactly five root categories';
  end if;
end
$$;
