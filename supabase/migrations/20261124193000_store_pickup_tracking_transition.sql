-- Keep the merchant tracking RPC transition rules aligned with the mobile
-- fulfillment state machine: store pickup is complete when the order is ready
-- for collection, while home delivery still requires an out-for-delivery step.
--
-- Patch the currently installed function definition so later authorization
-- hardening is preserved rather than replacing the function with an older body.

do $migration$
declare
  function_definition text;
  old_transition text := $old$    when 'ready_for_dispatch' then 'out_for_delivery'$old$;
  new_transition text := $new$    when 'ready_for_dispatch' then
      case
        when parent.delivery_type = 'desk' then 'delivered'
        when parent.delivery_type = 'home' then 'out_for_delivery'
        else null
      end$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.merchant_update_order_tracking(uuid,text,text)'::pg_catalog.regprocedure
  )
  into function_definition;

  if function_definition is null then
    raise exception 'merchant_tracking_function_not_found';
  end if;

  if pg_catalog.position(old_transition in function_definition) = 0 then
    raise exception 'merchant_tracking_transition_definition_not_found';
  end if;

  if pg_catalog.position(new_transition in function_definition) > 0 then
    raise exception 'merchant_tracking_transition_already_patched';
  end if;

  function_definition := pg_catalog.replace(
    function_definition,
    old_transition,
    new_transition
  );

  execute function_definition;
end
$migration$;
