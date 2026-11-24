-- Personal profile visibility is independent from merchant store visibility.
-- Personal and merchant accounts may publish their personal profile.
create or replace function private.sync_public_personal_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    delete from private.public_personal_profiles
    where user_id = old.user_id;
    return old;
  end if;

  if new.is_public is true
     and new.account_type in (
       'personal'::public.account_type,
       'merchant'::public.account_type
     ) then
    insert into private.public_personal_profiles (
      user_id, full_name, avatar_url, wilaya_id, commune, username, updated_at
    )
    values (
      new.user_id, new.full_name, new.avatar_url, new.wilaya_id,
      new.commune, new.username, now()
    )
    on conflict (user_id) do update
    set full_name = excluded.full_name,
        avatar_url = excluded.avatar_url,
        wilaya_id = excluded.wilaya_id,
        commune = excluded.commune,
        username = excluded.username,
        updated_at = now();
  else
    delete from private.public_personal_profiles
    where user_id = new.user_id;
  end if;

  return new;
end;
$function$;

revoke all on function private.sync_public_personal_profile()
  from public, anon, authenticated;

create index if not exists public_personal_profiles_username_idx
  on private.public_personal_profiles (username)
  where username is not null;

-- Backfill only profiles that have explicitly enabled public visibility.
insert into private.public_personal_profiles (
  user_id, full_name, avatar_url, wilaya_id, commune, username, updated_at
)
select user_id, full_name, avatar_url, wilaya_id, commune, username, now()
from public.profiles
where is_public is true
  and account_type in (
    'personal'::public.account_type,
    'merchant'::public.account_type
  )
on conflict (user_id) do update
set full_name = excluded.full_name,
    avatar_url = excluded.avatar_url,
    wilaya_id = excluded.wilaya_id,
    commune = excluded.commune,
    username = excluded.username,
    updated_at = now();

-- Allow personal and merchant accounts to control their personal page independently of store visibility.
create or replace function public.set_my_profile_visibility(_is_public boolean)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  current_type public.account_type;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select p.account_type
    into current_type
  from public.profiles p
  where p.user_id = auth.uid()
  for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  if current_type not in (
    'personal'::public.account_type,
    'merchant'::public.account_type
  ) then
    raise exception 'personal_profile_only';
  end if;

  update public.profiles
  set is_public = coalesce(_is_public, false)
  where user_id = auth.uid();
end;
$function$;

revoke all on function public.set_my_profile_visibility(boolean) from public, anon;
grant execute on function public.set_my_profile_visibility(boolean) to authenticated;

-- Public profile lookup by immutable username.
-- Reads only the privacy-filtered projection; never exposes profiles or private tables.
create or replace function public.get_public_personal_profile(_username text)
returns table (
  username text,
  full_name text,
  avatar_url text,
  wilaya_id integer,
  commune text
)
language sql
stable
security definer
set search_path = ''
set row_security = off
as $function$
  select
    p.username,
    p.full_name,
    p.avatar_url,
    p.wilaya_id,
    p.commune
  from private.public_personal_profiles p
  where p.username = lower(btrim(coalesce(_username, '')))
  limit 1;
$function$;

revoke all on function public.get_public_personal_profile(text) from public;
grant execute on function public.get_public_personal_profile(text) to anon, authenticated;

comment on function public.get_public_personal_profile(text) is
  'Returns a minimal personal profile only when it exists in the is_public-filtered projection. Does not expose profiles.user_id or private account data.';
