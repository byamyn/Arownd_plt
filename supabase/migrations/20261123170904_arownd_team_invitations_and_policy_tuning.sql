-- Secure invitation acceptance and additive team support policies.
begin;
alter table public.team_invitations add column if not exists invite_token_hash text, add column if not exists sent_at timestamptz;
create index if not exists team_invitations_token_hash_idx on public.team_invitations(invite_token_hash) where invite_token_hash is not null;

create or replace function public.accept_arownd_team_invitation(_token text)
returns uuid language plpgsql security definer set search_path=''
as $function$
declare v_user_id uuid:=auth.uid(); v_email text; v_invitation public.team_invitations; v_employee_id uuid;
begin
  if v_user_id is null then raise exception 'not_authenticated'; end if;
  if _token is null or char_length(_token)<32 or char_length(_token)>256 then raise exception 'invalid_invitation'; end if;
  select lower(u.email) into v_email from auth.users u where u.id=v_user_id;
  if v_email is null then raise exception 'authenticated_email_required'; end if;
  select i.* into v_invitation from public.team_invitations i
  where i.invite_token_hash=encode(extensions.digest(convert_to(_token,'UTF8'),'sha256'),'hex')
    and i.status='pending' and i.expires_at>now() for update;
  if not found then raise exception 'invitation_invalid_or_expired'; end if;
  if lower(v_invitation.email)<>v_email then raise exception 'invitation_email_mismatch'; end if;
  update public.team_employees e set user_id=v_user_id,status='active',updated_at=now()
  where e.id=v_invitation.employee_id and e.user_id is null and e.status='invited' and lower(e.email)=v_email
  returning e.id into v_employee_id;
  if v_employee_id is null then raise exception 'employee_invitation_unavailable'; end if;
  update public.team_invitations set status='accepted',accepted_at=now(),invite_token_hash=null where id=v_invitation.id;
  return v_employee_id;
end;
$function$;
revoke all on function public.accept_arownd_team_invitation(text) from public,anon;
grant execute on function public.accept_arownd_team_invitation(text) to authenticated;

drop policy if exists team_support_conversations_read on public.support_conversations;
drop policy if exists "Customers read own support conversations" on public.support_conversations;
create policy "Customers and Arownd team read support conversations" on public.support_conversations for select to authenticated
using (user_id=(select auth.uid()) or private.has_team_permission('support.view'));

drop policy if exists team_support_messages_read on public.support_messages;
drop policy if exists "Customers read own support messages" on public.support_messages;
create policy "Customers and Arownd team read support messages" on public.support_messages for select to authenticated
using (exists(select 1 from public.support_conversations c where c.id=support_messages.conversation_id
  and (c.user_id=(select auth.uid()) or private.has_team_permission('support.view'))));

drop policy if exists team_support_messages_reply on public.support_messages;
drop policy if exists "Customers send own support messages" on public.support_messages;
create policy "Customers and Arownd team send support messages" on public.support_messages for insert to authenticated
with check (sender_id=(select auth.uid()) and (
  (sender_role='customer' and exists(select 1 from public.support_conversations c where c.id=support_messages.conversation_id and c.user_id=(select auth.uid()) and c.status='open'))
  or (sender_role='admin' and private.has_team_permission('support.reply') and exists(select 1 from public.support_conversations c where c.id=support_messages.conversation_id and c.status='open'))
));
commit;
