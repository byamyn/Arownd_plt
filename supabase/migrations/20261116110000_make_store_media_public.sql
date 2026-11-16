-- Store logos and cover images are intentionally public for customer-facing store pages.
-- Upload, update and delete remain restricted by the existing merchant-owner policies.
update storage.buckets
set public = true
where id = 'store-media';
