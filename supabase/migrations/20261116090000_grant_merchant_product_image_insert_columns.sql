-- Allow the merchant product-creation RPC to insert only the image columns.
-- Row ownership remains enforced by the existing "Owners insert images" RLS policy.
grant insert (offer_id, image_url, is_primary)
  on table public.product_images
  to authenticated;
