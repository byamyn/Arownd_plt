-- Store team roles: owner, admin, staff.
-- Account type remains independent; personal accounts may join a store team.

create table if not exists public.store_team_members (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, user_id)
);

create index if not exists store_team_members_user_store_idx
  on public.store_team_members (user_id, store_id);

create table if not exists public.store_team_invitations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  invited_email text not null check (
    invited_email = lower(btrim(invited_email))
    and invited_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  role text not null check (role in ('admin', 'staff')),
  invited_by uuid not null references auth.users(id) on delete restrict,
  accepted_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz
);

create unique index if not exists store_team_invitations_pending_email_idx
  on public.store_team_invitations (store_id, invited_email)
  where status = 'pending';

create index if not exists store_team_invitations_store_status_idx
  on public.store_team_invitations (store_id, status, created_at desc);

alter table public.store_team_members enable row level security;
alter table public.store_team_invitations enable row level security;

drop policy if exists store_team_members_select on public.store_team_members;
create policy store_team_members_select
  on public.store_team_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.stores s
      where s.id = store_team_members.store_id
        and s.owner_id = (select auth.uid())
    )
  );

drop policy if exists store_team_invitations_select_owner on public.store_team_invitations;
create policy store_team_invitations_select_owner
  on public.store_team_invitations
  for select to authenticated
  using (
    exists (
      select 1 from public.stores s
      where s.id = store_team_invitations.store_id
        and s.owner_id = (select auth.uid())
    )
  );

revoke all on public.store_team_members from anon, authenticated;
revoke all on public.store_team_invitations from anon, authenticated;
grant select on public.store_team_members to authenticated;
grant select on public.store_team_invitations to authenticated;

create or replace function public.sync_store_owner_team_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.store_team_members (store_id, user_id, role)
    values (new.id, new.owner_id, 'owner')
    on conflict (store_id, user_id)
    do update set role = 'owner', updated_at = now();
    return new;
  end if;

  if old.owner_id is distinct from new.owner_id then
    delete from public.store_team_members
    where store_id = new.id and user_id = old.owner_id and role = 'owner';

    insert into public.store_team_members (store_id, user_id, role)
    values (new.id, new.owner_id, 'owner')
    on conflict (store_id, user_id)
    do update set role = 'owner', updated_at = now();
  end if;
  return new;
end;
$$;

revoke all on function public.sync_store_owner_team_membership() from public, anon, authenticated;

drop trigger if exists stores_sync_owner_team_membership on public.stores;
create trigger stores_sync_owner_team_membership
after insert or update of owner_id on public.stores
for each row execute function public.sync_store_owner_team_membership();

insert into public.store_team_members (store_id, user_id, role)
select s.id, s.owner_id, 'owner'
from public.stores s
where s.owner_id is not null
on conflict (store_id, user_id)
do update set role = 'owner', updated_at = now();

create or replace function public.invite_store_team_member(
  _store_id uuid,
  _email text,
  _role text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation_id uuid;
  normalized_email text := lower(btrim(coalesce(_email, '')));
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if _role not in ('admin', 'staff') then raise exception 'invalid_team_role'; end if;
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid_invitation_email';
  end if;
  if not exists (
    select 1 from public.stores s
    where s.id = _store_id and s.owner_id = auth.uid()
  ) then raise exception 'store_owner_required'; end if;
  if exists (
    select 1 from auth.users u
    where u.id = auth.uid() and lower(u.email) = normalized_email
  ) then raise exception 'cannot_invite_self'; end if;
  if exists (
    select 1 from public.store_team_members m
    join auth.users u on u.id = m.user_id
    where m.store_id = _store_id and lower(u.email) = normalized_email
  ) then raise exception 'already_store_member'; end if;
  if exists (
    select 1 from public.store_team_invitations i
    where i.store_id = _store_id and i.invited_email = normalized_email
      and i.status = 'pending' and i.expires_at > now()
  ) then raise exception 'invitation_already_pending'; end if;

  update public.store_team_invitations
  set status = 'expired'
  where store_id = _store_id and invited_email = normalized_email
    and status = 'pending' and expires_at <= now();

  insert into public.store_team_invitations (store_id, invited_email, role, invited_by)
  values (_store_id, normalized_email, _role, auth.uid())
  returning id into invitation_id;

  return invitation_id;
end;
$$;

create or replace function public.accept_store_team_invitation(_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
    raise exception 'invitation_expired';
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
$$;

create or replace function public.revoke_store_team_invitation(_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update public.store_team_invitations i
  set status = 'revoked', revoked_at = now()
  where i.id = _invitation_id
    and i.status = 'pending'
    and exists (
      select 1 from public.stores s
      where s.id = i.store_id and s.owner_id = auth.uid()
    );
  if not found then raise exception 'invitation_not_found_or_forbidden'; end if;
end;
$$;

create or replace function public.remove_store_team_member(_store_id uuid, _user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (
    select 1 from public.stores s
    where s.id = _store_id and s.owner_id = auth.uid()
  ) then raise exception 'store_owner_required'; end if;
  delete from public.store_team_members m
  where m.store_id = _store_id and m.user_id = _user_id
    and m.role in ('admin', 'staff');
  if not found then raise exception 'team_member_not_found'; end if;
end;
$$;

create or replace function public.update_store_team_member_role(
  _store_id uuid,
  _user_id uuid,
  _role text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if _role not in ('admin', 'staff') then raise exception 'invalid_team_role'; end if;
  if not exists (
    select 1 from public.stores s
    where s.id = _store_id and s.owner_id = auth.uid()
  ) then raise exception 'store_owner_required'; end if;
  update public.store_team_members m
  set role = _role, updated_at = now()
  where m.store_id = _store_id and m.user_id = _user_id
    and m.role in ('admin', 'staff');
  if not found then raise exception 'team_member_not_found'; end if;
end;
$$;

revoke all on function public.invite_store_team_member(uuid, text, text) from public, anon;
revoke all on function public.accept_store_team_invitation(uuid) from public, anon;
revoke all on function public.revoke_store_team_invitation(uuid) from public, anon;
revoke all on function public.remove_store_team_member(uuid, uuid) from public, anon;
revoke all on function public.update_store_team_member_role(uuid, uuid, text) from public, anon;

grant execute on function public.invite_store_team_member(uuid, text, text) to authenticated;
grant execute on function public.accept_store_team_invitation(uuid) to authenticated;
grant execute on function public.revoke_store_team_invitation(uuid) to authenticated;
grant execute on function public.remove_store_team_member(uuid, uuid) to authenticated;
grant execute on function public.update_store_team_member_role(uuid, uuid, text) to authenticated;
