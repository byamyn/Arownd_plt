-- Prevent direct PostgREST execution of the SECURITY DEFINER trigger function.
-- The function is invoked only by the stores trigger; callers do not need EXECUTE.
begin;

revoke all on function public.invalidate_pending_store_verification_on_profile_change()
  from public, anon, authenticated;

commit;
