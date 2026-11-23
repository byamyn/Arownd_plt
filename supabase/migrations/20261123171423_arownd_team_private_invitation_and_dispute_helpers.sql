-- Keep SECURITY DEFINER invitation acceptance and dispute membership lookup in private schema.
begin;
create or replace function private.accept_arownd_team_invitation(_token text)
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
revoke all on function private.accept_arownd_team_invitation(text) from public,anon;
grant execute on function private.accept_arownd_team_invitation(text) to authenticated;
create or replace function public.accept_arownd_team_invitation(_token text)
returns uuid language sql security invoker set search_path=''
as $function$ select private.accept_arownd_team_invitation(_token); $function$;
revoke all on function public.accept_arownd_team_invitation(text) from public,anon;
grant execute on function public.accept_arownd_team_invitation(text) to authenticated;

create or replace function private.is_current_user_dispute_support()
returns boolean language sql stable security definer set search_path=''
as $function$
  select auth.uid() is not null and (
    exists(select 1 from public.support_members sm where sm.user_id=auth.uid() and sm.is_active=true)
    or private.has_team_permission('disputes.view')
  );
$function$;
revoke all on function private.is_current_user_dispute_support() from public,anon;
grant execute on function private.is_current_user_dispute_support() to authenticated;
create or replace function public.is_current_user_dispute_support()
returns boolean language sql stable security invoker set search_path=''
as $function$ select private.is_current_user_dispute_support(); $function$;
revoke all on function public.is_current_user_dispute_support() from public,anon;
grant execute on function public.is_current_user_dispute_support() to authenticated;
commit;