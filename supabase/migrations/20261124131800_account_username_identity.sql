-- Account usernames are the immutable account identity and public URL key.
-- Existing accounts keep their current profile name until they claim a username.

alter table public.profiles
  add column if not exists username text;

alter table private.public_personal_profiles
  add column if not exists username text;

alter table public.profiles
  add constraint profiles_username_format_check
  check (
    username is null
    or (
      username = lower(btrim(username))
      and username ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
      and char_length(username) between 3 and 30
      and username not in (
        'admin', 'administrator', 'api', 'auth', 'console', 'help',
        'login', 'logout', 'profile', 'register', 'settings', 'signup',
        'support', 'store', 'stores', 'www', 'null'
      )
    )
  );

create unique index if not exists profiles_username_lower_uidx
  on public.profiles (lower(username))
  where username is not null;

create or replace function public.is_username_available(_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    _username is not null
    and lower(btrim(_username)) = _username
    and char_length(_username) between 3 and 30
    and _username ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
    and _username not in (
      'admin', 'administrator', 'api', 'auth', 'console', 'help',
      'login', 'logout', 'profile', 'register', 'settings', 'signup',
      'support', 'store', 'stores', 'www', 'null'
    )
    and not exists (
      select 1
      from public.profiles p
      where lower(p.username) = _username
    );
$function$;

revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to anon, authenticated;

create or replace function private.enforce_profile_username_identity()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' and old.username is not null
     and new.username is distinct from old.username then
    raise exception 'username_immutable';
  end if;

  if new.username is not null then
    new.username := lower(btrim(new.username));

    if char_length(new.username) not between 3 and 30
       or new.username !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' then
      raise exception 'username_invalid';
    end if;

    if new.username in (
      'admin', 'administrator', 'api', 'auth', 'console', 'help',
      'login', 'logout', 'profile', 'register', 'settings', 'signup',
      'support', 'store', 'stores', 'www', 'null'
    ) then
      raise exception 'username_reserved';
    end if;

    new.full_name := new.username;
  end if;

  return new;
end;
$function$;

revoke all on function private.enforce_profile_username_identity()
  from public, anon, authenticated;

drop trigger if exists profiles_username_identity_guard on public.profiles;
create trigger profiles_username_identity_guard
before insert or update of username, full_name on public.profiles
for each row
execute function private.enforce_profile_username_identity();

create or replace function public.claim_my_username(_username text)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  normalized_username text;
  existing_username text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  normalized_username := lower(btrim(coalesce(_username, '')));

  if char_length(normalized_username) not between 3 and 30
     or normalized_username !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' then
    raise exception 'username_invalid';
  end if;

  if normalized_username in (
    'admin', 'administrator', 'api', 'auth', 'console', 'help',
    'login', 'logout', 'profile', 'register', 'settings', 'signup',
    'support', 'store', 'stores', 'www', 'null'
  ) then
    raise exception 'username_reserved';
  end if;

  select p.username
    into existing_username
  from public.profiles p
  where p.user_id = auth.uid()
  for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  if existing_username is not null then
    raise exception 'username_already_claimed';
  end if;

  update public.profiles
  set username = normalized_username
  where user_id = auth.uid();
end;
$function$;

revoke all on function public.claim_my_username(text) from public, anon;
grant execute on function public.claim_my_username(text) to authenticated;

-- Keep the existing public-profile privacy gate. The username is added only
-- to the already-filtered projection and does not grant anonymous access.
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
     and new.account_type = 'personal'::public.account_type then
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

create or replace view public.public_personal_profiles
with (security_barrier = true, security_invoker = true)
as
select user_id, full_name, avatar_url, wilaya_id, commune, username
from private.public_personal_profiles;

insert into private.public_personal_profiles (
  user_id, full_name, avatar_url, wilaya_id, commune, username, updated_at
)
select user_id, full_name, avatar_url, wilaya_id, commune, username, now()
from public.profiles
where is_public is true
  and account_type = 'personal'::public.account_type
on conflict (user_id) do update
set full_name = excluded.full_name,
    avatar_url = excluded.avatar_url,
    wilaya_id = excluded.wilaya_id,
    commune = excluded.commune,
    username = excluded.username,
    updated_at = now();

-- New registrations must provide a Latin username. Keep full_name synchronized
-- for older application surfaces that still read the legacy column.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  requested_country_code text;
  requested_account_type public.account_type;
  requested_role public.app_role;
  requested_username text;
begin
  requested_country_code := upper(
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'country_code'), ''),
      'DZ'
    )
  );

  if not exists (
    select 1 from public.countries c
    where c.code = requested_country_code and c.is_enabled = true
  ) then
    raise exception 'country_not_available';
  end if;

  case lower(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'account_type'), ''), 'personal'))
    when 'personal' then
      requested_account_type := 'personal'::public.account_type;
      requested_role := 'customer'::public.app_role;
    when 'merchant' then
      requested_account_type := 'merchant'::public.account_type;
      requested_role := 'merchant'::public.app_role;
    else
      raise exception 'invalid_account_type';
  end case;

  requested_username := nullif(
    lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', ''))),
    ''
  );

  -- Backward compatibility: older mobile releases send full_name but do not
  -- know about username yet. Keep those signups working and let the user claim
  -- an immutable Latin username later from the profile screen.
  if requested_username is not null then
    if char_length(requested_username) not between 3 and 30
       or requested_username !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' then
      raise exception 'username_invalid';
    end if;

    if requested_username in (
      'admin', 'administrator', 'api', 'auth', 'console', 'help',
      'login', 'logout', 'profile', 'register', 'settings', 'signup',
      'support', 'store', 'stores', 'www', 'null'
    ) then
      raise exception 'username_reserved';
    end if;
  end if;

  insert into public.profiles (
    user_id, username, full_name, account_type, country_code, browsing_country_code
  )
  values (
    new.id,
    requested_username,
    coalesce(
      requested_username,
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), '')
    ),
    requested_account_type,
    requested_country_code,
    requested_country_code
  );

  insert into public.user_roles (user_id, role)
  values (new.id, requested_role)
  on conflict (user_id, role) do nothing;

  return new;
end;
$function$;
