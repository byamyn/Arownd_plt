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
