-- Personal profile previews are available only to signed-in users.
-- Keep the projection and its backing table aligned: anon must have neither
-- schema usage nor direct SELECT privileges on the private backing table.

revoke select on public.public_personal_profiles from anon;
revoke select on private.public_personal_profiles from anon;

drop policy if exists "Public can read opted-in personal profiles"
  on private.public_personal_profiles;

create policy "Authenticated users can read opted-in personal profiles"
  on private.public_personal_profiles
  for select to authenticated
  using (true);
