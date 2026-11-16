create or replace function public.enforce_merchant_media_quota()
returns trigger
language plpgsql
security definer
set search_path to ''
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

  if not exists (
    select 1
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.user_id
    join public.stores s on s.owner_id = p.user_id
    where p.user_id = actor_id
      and p.account_type::text = 'merchant'
      and ur.role::text = 'merchant'
  ) then
    raise exception 'merchant_media_upload_not_allowed';
  end if;

  if (new.bucket_id = 'store-media' and new.name !~ ('^' || actor_id::text || '/stores/[^/]+$'))
     or (new.bucket_id = 'product-media' and new.name !~ ('^' || actor_id::text || '/products/[^/]+$')) then
    raise exception 'invalid_merchant_media_path';
  end if;

  -- Storage preflight requests may provide contentLength before size is populated.
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
