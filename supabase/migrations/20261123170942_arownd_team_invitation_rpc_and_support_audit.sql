-- Atomic employee invitation creation and minimal support/dispute audit events.
begin;
create or replace function public.create_arownd_team_invitation(
  _email text,_full_name text,_job_title text,_rank text,_department_id uuid,_team_id uuid,
  _manager_id uuid,_role_ids uuid[],_invite_token_hash text
)
returns uuid language plpgsql security definer set search_path=''
as $function$
declare v_employee_id uuid; v_invitation_id uuid; v_email text:=lower(btrim(_email)); v_role_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not private.has_team_permission('employees.manage') then raise exception 'employees_manage_required'; end if;
  if not private.has_team_permission('roles.assign') then raise exception 'roles_assign_required'; end if;
  if v_email is null or char_length(v_email)<5 or char_length(v_email)>254 or position('@' in v_email)<2 then raise exception 'invalid_email'; end if;
  if _full_name is null or char_length(btrim(_full_name))<1 or char_length(btrim(_full_name))>120 then raise exception 'invalid_full_name'; end if;
  if _rank not in ('Executive','Head','Lead','Senior','Specialist','Associate') then raise exception 'invalid_rank'; end if;
  if _invite_token_hash is null or char_length(_invite_token_hash)<>64 then raise exception 'invalid_invitation_token'; end if;
  if _department_id is not null and not exists(select 1 from public.team_departments d where d.id=_department_id and d.is_active) then raise exception 'invalid_department'; end if;
  if _team_id is not null and not exists(select 1 from public.team_teams t where t.id=_team_id and t.is_active and (_department_id is null or t.department_id=_department_id)) then raise exception 'invalid_team'; end if;
  if _manager_id is not null and not exists(select 1 from public.team_employees m where m.id=_manager_id and m.status='active') then raise exception 'invalid_manager'; end if;
  if exists(select 1 from public.team_employees e where lower(e.email)=v_email and e.status in ('invited','active')) then raise exception 'employee_email_already_exists'; end if;
  if exists(select 1 from public.team_invitations i where i.invite_token_hash=_invite_token_hash and i.status='pending') then raise exception 'invitation_token_already_used'; end if;
  insert into public.team_employees(email,full_name,job_title,rank,status,created_by,department_id,team_id,manager_id)
  values(v_email,btrim(_full_name),nullif(btrim(_job_title),''),_rank,'invited',auth.uid(),_department_id,_team_id,_manager_id)
  returning id into v_employee_id;
  foreach v_role_id in array coalesce(_role_ids,'{}'::uuid[]) loop
    if not exists(select 1 from public.team_roles r where r.id=v_role_id and r.is_active and r.code<>'founder_ceo') then raise exception 'invalid_or_protected_role'; end if;
    insert into public.team_employee_roles(employee_id,role_id,assigned_by) values(v_employee_id,v_role_id,auth.uid()) on conflict do nothing;
  end loop;
  insert into public.team_invitations(employee_id,email,invited_by,status,invite_token_hash,sent_at)
  values(v_employee_id,v_email,auth.uid(),'pending',_invite_token_hash,now())
  returning id into v_invitation_id;
  return v_employee_id;
end;
$function$;
revoke all on function public.create_arownd_team_invitation(text,text,text,text,uuid,uuid,uuid,uuid[],text) from public,anon;
grant execute on function public.create_arownd_team_invitation(text,text,text,text,uuid,uuid,uuid,uuid[],text) to authenticated;

create or replace function private.audit_team_support_reply()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if new.sender_role='admin' then
    insert into public.team_audit_logs(actor_id,action,entity_type,entity_id,summary,metadata)
    values(new.sender_id,'reply','support_conversation',new.conversation_id,'Replied to support conversation',
      jsonb_build_object('message_id',new.id,'sender_role',new.sender_role));
  end if;
  return new;
end;
$function$;
revoke all on function private.audit_team_support_reply() from public,anon,authenticated;
create trigger team_support_reply_audit after insert on public.support_messages
for each row execute function private.audit_team_support_reply();

create or replace function private.audit_team_dispute_resolution()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if old.status is distinct from new.status and new.status='resolved' then
    insert into public.team_audit_logs(actor_id,action,entity_type,entity_id,summary,metadata)
    values(new.resolved_by,'resolve','merchant_order_dispute',new.id,'Resolved merchant order dispute',
      jsonb_build_object('status_before',old.status,'status_after',new.status,'resolved_at',new.resolved_at));
  end if;
  return new;
end;
$function$;
revoke all on function private.audit_team_dispute_resolution() from public,anon,authenticated;
create trigger team_dispute_resolution_audit after update on public.merchant_order_disputes
for each row execute function private.audit_team_dispute_resolution();
commit;