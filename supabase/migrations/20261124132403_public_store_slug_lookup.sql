-- Public storefront lookup by immutable store slug.
-- Exposes only storefront fields and currently purchasable offer data.
-- SECURITY DEFINER is narrowly scoped to this read-only projection; base-table RLS is unchanged.

create or replace function public.get_public_store_by_slug(_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $function$
  select jsonb_build_object(
    'store', jsonb_build_object(
      'id', s.id, 'name', s.name, 'slug', s.slug,
      'description', s.description, 'phone', s.phone, 'whatsapp', s.whatsapp,
      'commune', s.commune, 'address_line', s.address_line,
      'latitude', s.latitude, 'longitude', s.longitude,
      'opening_hours', s.opening_hours, 'logo_url', s.logo_url,
      'cover_url', s.cover_url, 'rating', s.rating,
      'is_verified', s.is_verified, 'category', s.category,
      'website_url', s.website_url, 'instagram_url', s.instagram_url,
      'facebook_url', s.facebook_url, 'tiktok_url', s.tiktok_url,
      'country_code', s.country_code
    ),
    'offers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', offer.id, 'price', offer.price, 'old_price', offer.old_price,
          'options', offer.options,
          'product', jsonb_build_object(
            'id', offer.product_id, 'name', offer.product_name,
            'description', offer.product_description, 'brand', offer.product_brand,
            'category', offer.product_category, 'rating', offer.product_rating
          ),
          'images', offer.images
        ) order by offer.created_at desc
      )
      from (
        select so.id, so.product_id, so.price, so.old_price, so.options, so.created_at,
          p.name as product_name, p.description as product_description,
          p.brand as product_brand, p.category as product_category, p.rating as product_rating,
          coalesce((
            select jsonb_agg(
              jsonb_build_object('url', pi.image_url, 'is_primary', pi.is_primary)
              order by pi.is_primary desc, pi.created_at asc
            )
            from public.product_images pi where pi.offer_id = so.id
          ), '[]'::jsonb) as images
        from public.store_offers so
        join public.products p on p.id = so.product_id
        where so.store_id = s.id
          and so.is_available is true
          and so.is_merchant_hidden is false
          and so.stock_quantity > 0
        order by so.created_at desc
        limit 100
      ) offer
    ), '[]'::jsonb)
  )
  from public.stores s
  where s.slug = lower(btrim(coalesce(_slug, '')))
    and s.slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  limit 1;
$function$;

revoke all on function public.get_public_store_by_slug(text) from public;
grant execute on function public.get_public_store_by_slug(text) to anon, authenticated;

comment on function public.get_public_store_by_slug(text) is
  'Returns a minimal public storefront projection by slug, including only in-stock visible offers. Does not expose owner or operational data; base-table RLS remains unchanged.';
