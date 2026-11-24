-- Store pickup is collected at the merchant location and must not require
-- a residential street address. This migration changes the RPC definition only
-- when explicitly applied; it is not executed by application deployments.
do $migration$
declare
  function_definition text;
  old_address_guard text := '     or nullif(btrim(_address_line), '''') is null';
  new_address_guard text := '     or (_delivery_type = ''home'' and nullif(btrim(_address_line), '''') is null)';
begin
  select pg_get_functiondef(
    'public.create_checkout_order_for_account(jsonb,text,bigint,bigint,text,text,text,text,text,text,uuid)'::regprocedure
  ) into function_definition;

  if position(old_address_guard in function_definition) = 0 then
    if position(new_address_guard in function_definition) > 0 then
      return;
    end if;
    raise exception 'checkout_address_guard_not_found';
  end if;

  function_definition := replace(function_definition, old_address_guard, new_address_guard);
  execute function_definition;
end;
$migration$;
