create or replace function public.submit_store_verification_request()
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  owned_store_count integer;
  selected_store_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select count(*) into owned_store_count
  from public.stores s
  where s.owner_id = auth.uid();

  if owned_store_count = 0 then
    raise exception 'merchant_store_not_found';
  end if;
  if owned_store_count > 1 then
    raise exception 'store_id_required';
  end if;

  select s.id into selected_store_id
  from public.stores s
  where s.owner_id = auth.uid()
  limit 1;

  return public.submit_store_verification_request(selected_store_id);
end;
$function$;

revoke all on function public.submit_store_verification_request() from public, anon;
grant execute on function public.submit_store_verification_request() to authenticated;
