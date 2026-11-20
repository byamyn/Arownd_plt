do $migration$
declare fn text; old_text text; new_text text;
begin
 fn:=pg_get_functiondef('public.get_my_store_analytics(uuid)'::regprocedure);
 old_text:=$old$if not exists (
    select 1 from public.stores s
    where s.id = _store_id and s.owner_id = auth.uid()
  ) then$old$;
 new_text:=$new$if not private.can_manage_store_orders(_store_id) then$new$;
 if position(old_text in fn)=0 then raise exception 'analytics_role_guard_not_found'; end if;
 execute replace(fn,old_text,new_text);
end
$migration$;