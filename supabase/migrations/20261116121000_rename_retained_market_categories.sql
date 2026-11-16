-- Apply the final approved Arabic labels to the five retained marketplace categories.
-- Keep stable IDs and all child-category relationships unchanged.

do $$
begin
  if (select count(*) from public.categories
      where parent_id is null
        and id in ('fashion', 'electronics', 'beauty', 'home', 'misc')) <> 5 then
    raise exception 'Expected exactly the five retained root categories; aborting rename';
  end if;
end
$$;

update public.categories
set label_ar = case id
  when 'fashion' then 'الأزياء والأناقة'
  when 'electronics' then 'التكنولوجيا والأجهزة الإلكترونية'
  when 'beauty' then 'الجمال والعناية'
  when 'home' then 'المنزل والأثاث'
  when 'misc' then 'مستلزمات ومنتجات متنوعة'
end
where parent_id is null
  and id in ('fashion', 'electronics', 'beauty', 'home', 'misc');

do $$
begin
  if exists (
    select 1
    from (values
      ('fashion', 'الأزياء والأناقة'),
      ('electronics', 'التكنولوجيا والأجهزة الإلكترونية'),
      ('beauty', 'الجمال والعناية'),
      ('home', 'المنزل والأثاث'),
      ('misc', 'مستلزمات ومنتجات متنوعة')
    ) as expected(id, label_ar)
    left join public.categories c on c.id = expected.id and c.parent_id is null
    where c.id is null or c.label_ar <> expected.label_ar
  ) then
    raise exception 'Category rename verification failed';
  end if;
end
$$;
