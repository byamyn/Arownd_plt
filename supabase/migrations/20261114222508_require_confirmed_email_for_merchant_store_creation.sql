-- Require a confirmed email before a merchant can create its store.
do $migration$
declare
  function_definition text;
  old_guard text := '  if auth.uid() is null then raise exception ''not_authenticated''; end if;';
  new_guard text := '  if auth.uid() is null then raise exception ''not_authenticated''; end if;
  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email_confirmed_at is not null
  ) then
    raise exception ''email_not_confirmed'';
  end if;';
begin
  select pg_get_functiondef(
    'public.create_my_store_for_account(text,text,text,text,bigint,bigint,text,text,double precision,double precision,jsonb,text,text[])'::regprocedure
  ) into function_definition;

  if position(old_guard in function_definition) = 0 then
    raise exception 'merchant_store_creation_auth_guard_not_found';
  end if;

  if position('email_confirmed_at is not null' in function_definition) > 0 then
    raise notice 'merchant store creation already requires confirmed email';
    return;
  end if;

  function_definition := replace(function_definition, old_guard, new_guard);
  execute function_definition;
end;
$migration$;