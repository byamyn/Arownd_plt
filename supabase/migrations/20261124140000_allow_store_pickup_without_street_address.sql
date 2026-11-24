-- Allow store pickup without a home street address while preserving home-delivery validation.
-- This migration changes only the versioned database function definition; it does not
-- apply itself to any hosted Supabase project.

do $migration$
declare
  function_definition text;
  address_guard text := 'or nullif(btrim(_address_line), '''') is null';
  address_insert text := 'account_currency_code, btrim(_commune), btrim(_address_line),';
begin
  select pg_catalog.pg_get_functiondef(
    'public.create_checkout_order_for_account(jsonb, text, bigint, bigint, text, text, text, text, text, text, uuid)'::pg_catalog.regprocedure
  )
  into function_definition;

  if function_definition is null then
    raise exception 'create_checkout_order_for_account function was not found';
  end if;

  if pg_catalog.strpos(function_definition, address_guard) = 0 then
    raise exception 'Expected checkout street-address validation was not found; review the current function before applying this migration';
  end if;

  if pg_catalog.strpos(function_definition, address_insert) = 0 then
    raise exception 'Expected checkout address insert expression was not found; review the current function before applying this migration';
  end if;

  function_definition := pg_catalog.replace(
    function_definition,
    address_guard,
    'or (_delivery_type = ''home'' and nullif(btrim(_address_line), '''') is null)'
  );

  function_definition := pg_catalog.replace(
    function_definition,
    address_insert,
    'account_currency_code, btrim(_commune), case when _delivery_type = ''home'' then btrim(_address_line) else null end,'
  );

  execute function_definition;

  select pg_catalog.pg_get_functiondef(
    'public.create_checkout_order_for_account(jsonb, text, bigint, bigint, text, text, text, text, text, text, uuid)'::pg_catalog.regprocedure
  )
  into function_definition;

  if pg_catalog.strpos(function_definition, '_delivery_type = ''home'' and nullif(btrim(_address_line), '''') is null') = 0
     or pg_catalog.strpos(function_definition, 'case when _delivery_type = ''home'' then btrim(_address_line) else null end') = 0 then
    raise exception 'Store-pickup checkout function verification failed';
  end if;
end;
$migration$;
