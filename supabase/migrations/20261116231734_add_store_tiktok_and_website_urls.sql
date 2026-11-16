alter table public.stores
  add column if not exists tiktok_url text,
  add column if not exists website_url text;
