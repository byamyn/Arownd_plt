create or replace function public.accept_store_team_invitation(_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  invitation public.store_team_invitations%rowtype;
  current_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if current_email = '' then raise exception 'verified_email_required'; end if;
  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email_confirmed_at is not null
      and lower(u.email) = current_email
  ) then raise exception 'verified_email_required'; end if;

  select * into invitation
  from public.store_team_invitations i
  where i.id = _invitation_id
  for update;

  if not found then raise exception 'invitation_not_found'; end if;
  if invitation.status <> 'pending' then raise exception 'invitation_not_pending'; end if;
  if invitation.expires_at <= now() then
    update public.store_team_invitations set status = 'expired'
    where id = _invitation_id;
    return null;
  end if;
  if invitation.invited_email <> current_email then
    raise exception 'invitation_email_mismatch';
  end if;
  if exists (
    select 1 from public.store_team_members m
    where m.store_id = invitation.store_id and m.user_id = auth.uid()
  ) then raise exception 'already_store_member'; end if;

  insert into public.store_team_members (store_id, user_id, role)
  values (invitation.store_id, auth.uid(), invitation.role);

  update public.store_team_invitations
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = _invitation_id;

  return invitation.store_id;
end;
$function$;

revoke all on function public.accept_store_team_invitation(uuid) from public, anon;
grant execute on function public.accept_store_team_invitation(uuid) to authenticated;