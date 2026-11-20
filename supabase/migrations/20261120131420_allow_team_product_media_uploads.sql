create or replace function public.enforce_merchant_media_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid;
  new_size bigint;
  used_bytes bigint;
begin
  if new.bucket_id not in ('store-media', 'product-media') then
    return new;
  end if;

  if split_part(new.name, '/', 1) !~ '^[0-9a-fA-F-]{36}$' then
    raise exception 'invalid_merchant_media_path';
  end if;
  actor_id := split_part(new.name, '/', 1)::uuid;

  if actor_id is distinct from auth.uid() then
    raise exception 'invalid_merchant_media_path';
  end if;

  if new.bucket_id = 'store-media' then
    if not exists (
      select 1 from public.stores s where s.owner_id = actor_id
    ) then
      raise exception 'merchant_media_upload_not_allowed';
    end if;
  elsif new.bucket_id = 'product-media' then
    if not exists (
      select 1 from public.store_team_members m
      where m.user_id = actor_id and m.role in ('owner', 'admin')
    ) then
      raise exception 'merchant_media_upload_not_allowed';
    end if;
  end if;

  if (new.bucket_id = 'store-media' and new.name !~ ('^' || actor_id::text || '/stores/[^/]+$'))
     or (new.bucket_id = 'product-media' and new.name !~ ('^' || actor_id::text || '/products/[^/]+$')) then
    raise exception 'invalid_merchant_media_path';
  end if;

  new_size := coalesce(
    nullif(new.metadata->>'size', '')::bigint,
    nullif(new.metadata->>'contentLength', '')::bigint
  );
  if new_size is null or new_size <= 0 then
    raise exception 'invalid_merchant_media_size';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));

  select coalesce(
    sum(
      coalesce(
        nullif(o.metadata->>'size', '')::bigint,
        nullif(o.metadata->>'contentLength', '')::bigint
      )
    ),
    0
  )
  into used_bytes
  from storage.objects o
  where o.bucket_id in ('store-media', 'product-media')
    and split_part(o.name, '/', 1) = actor_id::text
    and o.id is distinct from new.id;

  if used_bytes + new_size > 104857600 then
    raise exception 'merchant_media_quota_exceeded';
  end if;

  return new;
end;
$function$;
