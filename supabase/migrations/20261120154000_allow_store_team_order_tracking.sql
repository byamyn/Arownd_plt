do $migration$
declare fn text; old_text text; new_text text;
begin
 fn:=pg_get_functiondef('public.merchant_update_order_tracking(uuid,text,text)'::regprocedure);
 old_text:=$old$private.is_store_owner(v_order.store_id)$old$;
 new_text:=$new$private.can_process_store_orders(v_order.store_id)$new$;
 if position(old_text in fn)=0 then raise exception 'tracking_role_guard_not_found'; end if;
 execute replace(fn,old_text,new_text);

 fn:=pg_get_functiondef('public.merchant_update_merchant_order_status(uuid,text)'::regprocedure);
 old_text:=$old$private.is_store_owner(mo.store_id)$old$;
 new_text:=$new$private.can_process_store_orders(mo.store_id)$new$;
 if position(old_text in fn)=0 then raise exception 'delivery_role_guard_not_found'; end if;
 execute replace(fn,old_text,new_text);
end
$migration$;