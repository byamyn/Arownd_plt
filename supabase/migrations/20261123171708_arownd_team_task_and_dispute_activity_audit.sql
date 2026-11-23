-- Add audit events for task comments and support replies in dispute threads.
begin;
create or replace function private.audit_team_task_comment()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  insert into public.team_audit_logs(actor_id,action,entity_type,entity_id,summary,metadata)
  values(new.author_id,'comment','team_task',new.task_id,'Added a comment to a team task',jsonb_build_object('comment_id',new.id));
  return new;
end;
$function$;
revoke all on function private.audit_team_task_comment() from public,anon,authenticated;
create trigger team_task_comment_audit after insert on public.team_task_comments
for each row execute function private.audit_team_task_comment();

create or replace function private.audit_team_dispute_message()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if new.sender_role='support' then
    insert into public.team_audit_logs(actor_id,action,entity_type,entity_id,summary,metadata)
    values(new.sender_id,'reply','merchant_order_dispute',new.dispute_id,'Replied to merchant order dispute',
      jsonb_build_object('message_id',new.id,'sender_role',new.sender_role));
  end if;
  return new;
end;
$function$;
revoke all on function private.audit_team_dispute_message() from public,anon,authenticated;
create trigger team_dispute_message_audit after insert on public.merchant_order_dispute_messages
for each row execute function private.audit_team_dispute_message();
commit;