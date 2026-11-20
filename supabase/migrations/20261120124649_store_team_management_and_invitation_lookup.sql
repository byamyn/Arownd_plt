create or replace function public.get_store_team_members(_store_id uuid)
returns table (
  user_id uuid,
  role text,
  full_name text,
  avatar_url text,
  email text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (
    select 1 from public.stores s
    where s.id = _store_id and s.owner_id = auth.uid()
  ) then raise exception 'store_owner_required'; end if;

  return query
  select m.user_id, m.role, p.full_name, p.avatar_url, u.email::text, m.created_at
  from public.store_team_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.user_id = m.user_id
  where m.store_id = _store_id
  order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.created_at;
end;
$function$;

create or replace function public.get_my_pending_store_team_invitations()
returns table (
  invitation_id uuid,
  store_id uuid,
  store_name text,
  role text,
  expires_at timestamptz,
  invited_email text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  current_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if current_email = '' or not exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and lower(u.email) = current_email
  ) then
    raise exception 'verified_email_required';
  end if;

  return query
  select i.id, i.store_id, s.name, i.role, i.expires_at, i.invited_email
  from public.store_team_invitations i
  join public.stores s on s.id = i.store_id
  where i.status = 'pending'
    and i.expires_at > now()
    and i.invited_email = current_email
  order by i.created_at desc;
end;
$function$;

revoke all on function public.get_store_team_members(uuid) from public, anon;
revoke all on function public.get_my_pending_store_team_invitations() from public, anon;
grant execute on function public.get_store_team_members(uuid) to authenticated;
grant execute on function public.get_my_pending_store_team_invitations() to authenticated;