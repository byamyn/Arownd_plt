-- Store verification workflow.
-- This migration is intentionally committed to source control only.
-- Do NOT apply it to the live Supabase project without explicit owner approval.
begin;

create table if not exists public.store_verification_reviewers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_active boolean not null default true,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id) on delete set null
);

alter table public.store_verification_reviewers enable row level security;
revoke all on table public.store_verification_reviewers from anon, authenticated;
grant select on table public.store_verification_reviewers to authenticated;
grant all on table public.store_verification_reviewers to service_role;

drop policy if exists "Reviewers read own assignment" on public.store_verification_reviewers;
create policy "Reviewers read own assignment"
  on public.store_verification_reviewers
  for select to authenticated
  using (user_id = (select auth.uid()) and is_active = true);

create or replace function public.is_store_verification_reviewer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null
    and exists (
      select 1
      from public.store_verification_reviewers r
      where r.user_id = auth.uid()
        and r.is_active = true
    );
$function$;

revoke all on function public.is_store_verification_reviewer() from public, anon;
grant execute on function public.is_store_verification_reviewer() to authenticated;

create table if not exists public.store_verification_requests (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  submitted_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('draft', 'pending', 'approved', 'rejected')),
  profile_snapshot jsonb not null,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text,
  created_at timestamptz not null default now(),
  constraint store_verification_review_fields_check check (
    (status in ('approved', 'rejected') and reviewed_at is not null)
    or (status in ('draft', 'pending') and reviewed_at is null and reviewed_by is null)
  )
);

create unique index if not exists store_verification_one_pending_per_store_idx
  on public.store_verification_requests(store_id)
  where status = 'pending';

create index if not exists store_verification_requests_submitted_idx
  on public.store_verification_requests(status, submitted_at);

alter table public.store_verification_requests enable row level security;
revoke all on table public.store_verification_requests from anon, authenticated;
grant select on table public.store_verification_requests to authenticated;
grant all on table public.store_verification_requests to service_role;

drop policy if exists "Store owners read own verification requests" on public.store_verification_requests;
create policy "Store owners read own verification requests"
  on public.store_verification_requests
  for select to authenticated
  using (
    exists (
      select 1 from public.stores s
      where s.id = store_verification_requests.store_id
        and s.owner_id = (select auth.uid())
    )
  );

drop policy if exists "Authorized reviewers read verification requests" on public.store_verification_requests;
create policy "Authorized reviewers read verification requests"
  on public.store_verification_requests
  for select to authenticated
  using (public.is_store_verification_reviewer());

create table if not exists public.store_verification_audit_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.store_verification_requests(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null
    check (event_type in ('submitted', 'approved', 'rejected', 'profile_changed')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists store_verification_audit_store_idx
  on public.store_verification_audit_events(store_id, created_at desc);

alter table public.store_verification_audit_events enable row level security;
revoke all on table public.store_verification_audit_events from anon, authenticated;
grant select on table public.store_verification_audit_events to authenticated;
grant all on table public.store_verification_audit_events to service_role;

drop policy if exists "Store owners read own verification audit" on public.store_verification_audit_events;
create policy "Store owners read own verification audit"
  on public.store_verification_audit_events
  for select to authenticated
  using (
    exists (
      select 1
      from public.stores s
      where s.id = store_verification_audit_events.store_id
        and s.owner_id = (select auth.uid())
    )
  );

drop policy if exists "Authorized reviewers read verification audit" on public.store_verification_audit_events;
create policy "Authorized reviewers read verification audit"
  on public.store_verification_audit_events
  for select to authenticated
  using (public.is_store_verification_reviewer());

create or replace function public.force_new_stores_unverified()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.is_verified := false;
  return new;
end;
$function$;

drop trigger if exists stores_force_unverified_on_insert on public.stores;
create trigger stores_force_unverified_on_insert
before insert on public.stores
for each row execute function public.force_new_stores_unverified();

create or replace function public.invalidate_pending_store_verification_on_profile_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  changed_request_id uuid;
  approved_request_id uuid;
begin
  if new.name is distinct from old.name
     or new.logo_url is distinct from old.logo_url
     or new.phone is distinct from old.phone
     or new.region_id is distinct from old.region_id
     or new.secondary_region_id is distinct from old.secondary_region_id
     or new.commune is distinct from old.commune
     or new.address_line is distinct from old.address_line
     or new.opening_hours is distinct from old.opening_hours then
    update public.store_verification_requests
    set status = 'draft'
    where store_id = new.id and status = 'pending'
    returning id into changed_request_id;

    if changed_request_id is not null then
      insert into public.store_verification_audit_events (
        request_id, store_id, actor_id, event_type, details
      ) values (
        changed_request_id, new.id, auth.uid(), 'profile_changed',
        jsonb_build_object('reason', 'required_store_profile_changed')
      );
    end if;

    -- A verified store loses its badge when any required identity field changes.
    -- The owner must submit the updated profile for a fresh review.
    if old.is_verified then
      update public.stores set is_verified = false where id = new.id;

      select r.id into approved_request_id
      from public.store_verification_requests r
      where r.store_id = new.id and r.status = 'approved'
      order by r.reviewed_at desc
      limit 1;

      if approved_request_id is not null then
        insert into public.store_verification_audit_events (
          request_id, store_id, actor_id, event_type, details
        ) values (
          approved_request_id, new.id, auth.uid(), 'profile_changed',
          jsonb_build_object('reason', 'approved_profile_changed', 'verification_revoked', true)
        );
      end if;
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists stores_invalidate_pending_verification on public.stores;
create trigger stores_invalidate_pending_verification
after update of name, logo_url, phone, region_id, secondary_region_id,
  commune, address_line, opening_hours
on public.stores
for each row execute function public.invalidate_pending_store_verification_on_profile_change();

create or replace function public.submit_store_verification_request()
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_store public.stores;
  v_request_id uuid;
  v_snapshot jsonb;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
  ) then
    raise exception 'email_not_confirmed';
  end if;

  select s.* into v_store
  from public.stores s
  where s.owner_id = auth.uid()
  for update;

  if not found then
    raise exception 'merchant_store_not_found';
  end if;
  if v_store.is_verified then
    raise exception 'store_already_verified';
  end if;

  if nullif(btrim(v_store.name), '') is null
     or nullif(btrim(coalesce(v_store.logo_url, '')), '') is null
     or nullif(btrim(coalesce(v_store.phone, '')), '') is null
     or v_store.region_id is null
     or nullif(btrim(coalesce(v_store.commune, '')), '') is null
     or nullif(btrim(coalesce(v_store.address_line, '')), '') is null
     or v_store.opening_hours is null
     or jsonb_typeof(v_store.opening_hours) <> 'object'
     or coalesce(v_store.opening_hours ->> 'open', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]
    raise exception 'store_verification_profile_incomplete';
  end if;

  if exists (
    select 1 from public.store_verification_requests r
    where r.store_id = v_store.id and r.status = 'pending'
  ) then
    raise exception 'store_verification_request_pending';
  end if;

  v_snapshot := jsonb_build_object(
    'name', v_store.name,
    'logo_url', v_store.logo_url,
    'phone', v_store.phone,
    'region_id', v_store.region_id,
    'secondary_region_id', v_store.secondary_region_id,
    'commune', v_store.commune,
    'address_line', v_store.address_line,
    'opening_hours', v_store.opening_hours
  );

  insert into public.store_verification_requests (
    store_id, submitted_by, status, profile_snapshot
  ) values (
    v_store.id, auth.uid(), 'pending', v_snapshot
  ) returning id into v_request_id;

  insert into public.store_verification_audit_events (
    request_id, store_id, actor_id, event_type, details
  ) values (
    v_request_id, v_store.id, auth.uid(), 'submitted',
    jsonb_build_object('profile_snapshot', v_snapshot)
  );

  update public.stores set is_verified = false where id = v_store.id;

  return v_request_id;
end;
$function$;

revoke all on function public.submit_store_verification_request() from public, anon;
grant execute on function public.submit_store_verification_request() to authenticated;

create or replace function public.review_store_verification_request(
  _request_id uuid,
  _decision text,
  _note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request public.store_verification_requests;
  v_store public.stores;
  v_snapshot jsonb;
  v_store_id uuid;
  v_note text := nullif(btrim(coalesce(_note, '')), '');
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_store_verification_reviewer() then
    raise exception 'not_authorized';
  end if;
  if _decision is null or _decision not in ('approved', 'rejected') then
    raise exception 'invalid_verification_decision';
  end if;
  if _decision = 'rejected' and v_note is null then
    raise exception 'verification_rejection_note_required';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'verification_review_note_too_long';
  end if;

  select r.store_id into v_store_id
  from public.store_verification_requests r
  where r.id = _request_id;
  if not found then
    raise exception 'verification_request_not_pending';
  end if;

  -- Lock the store before its request. The profile-change trigger uses the
  -- same lock order, preventing a request/store deadlock during concurrent edits.
  select s.* into v_store
  from public.stores s
  where s.id = v_store_id
  for update;
  if not found then
    raise exception 'merchant_store_not_found';
  end if;

  select r.* into v_request
  from public.store_verification_requests r
  where r.id = _request_id
  for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'verification_request_not_pending';
  end if;

  v_snapshot := jsonb_build_object(
    'name', v_store.name,
    'logo_url', v_store.logo_url,
    'phone', v_store.phone,
    'region_id', v_store.region_id,
    'secondary_region_id', v_store.secondary_region_id,
    'commune', v_store.commune,
    'address_line', v_store.address_line,
    'opening_hours', v_store.opening_hours
  );

  if v_request.profile_snapshot is distinct from v_snapshot then
    update public.store_verification_requests
    set status = 'draft'
    where id = _request_id;

    insert into public.store_verification_audit_events (
      request_id, store_id, actor_id, event_type, details
    ) values (
      _request_id, v_store.id, auth.uid(), 'profile_changed',
      jsonb_build_object('reason', 'profile_snapshot_mismatch')
    );
    return _request_id;
  end if;

  update public.store_verification_requests
  set status = _decision,
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      review_note = v_note
  where id = _request_id;

  update public.stores
  set is_verified = (_decision = 'approved')
  where id = v_store.id;

  insert into public.store_verification_audit_events (
    request_id, store_id, actor_id, event_type, details
  ) values (
    _request_id, v_store.id, auth.uid(), _decision,
    jsonb_build_object('note', v_note)
  );

  return _request_id;
end;
$function$;

revoke all on function public.review_store_verification_request(uuid, text, text)
  from public, anon;
grant execute on function public.review_store_verification_request(uuid, text, text)
  to authenticated;

-- All existing stores must be re-reviewed. No store or commerce data is deleted.
alter table public.stores alter column is_verified set default false;
update public.stores set is_verified = false where is_verified is distinct from false;

drop policy if exists "Merchants create own store" on public.stores;
create policy "Merchants create own store"
  on public.stores for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and public.has_role((select auth.uid()), 'merchant'::public.app_role)
    and is_verified = false
  );

commit;

-- Reviewer assignment is deliberately not exposed to authenticated users.
-- Add an approved reviewer manually through the Supabase SQL Editor after this
-- migration has been reviewed and explicitly approved:
-- insert into public.store_verification_reviewers (user_id)
-- values ('<AUTH_USER_UUID>')
-- on conflict (user_id) do update set is_active = true;

     or coalesce(v_store.opening_hours ->> 'close', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]
    raise exception 'store_verification_profile_incomplete';
  end if;

  if exists (
    select 1 from public.store_verification_requests r
    where r.store_id = v_store.id and r.status = 'pending'
  ) then
    raise exception 'store_verification_request_pending';
  end if;

  v_snapshot := jsonb_build_object(
    'name', v_store.name,
    'logo_url', v_store.logo_url,
    'phone', v_store.phone,
    'region_id', v_store.region_id,
    'secondary_region_id', v_store.secondary_region_id,
    'commune', v_store.commune,
    'address_line', v_store.address_line,
    'opening_hours', v_store.opening_hours
  );

  insert into public.store_verification_requests (
    store_id, submitted_by, status, profile_snapshot
  ) values (
    v_store.id, auth.uid(), 'pending', v_snapshot
  ) returning id into v_request_id;

  insert into public.store_verification_audit_events (
    request_id, store_id, actor_id, event_type, details
  ) values (
    v_request_id, v_store.id, auth.uid(), 'submitted',
    jsonb_build_object('profile_snapshot', v_snapshot)
  );

  update public.stores set is_verified = false where id = v_store.id;

  return v_request_id;
end;
$function$;

revoke all on function public.submit_store_verification_request() from public, anon;
grant execute on function public.submit_store_verification_request() to authenticated;

create or replace function public.review_store_verification_request(
  _request_id uuid,
  _decision text,
  _note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request public.store_verification_requests;
  v_store public.stores;
  v_snapshot jsonb;
  v_store_id uuid;
  v_note text := nullif(btrim(coalesce(_note, '')), '');
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_store_verification_reviewer() then
    raise exception 'not_authorized';
  end if;
  if _decision is null or _decision not in ('approved', 'rejected') then
    raise exception 'invalid_verification_decision';
  end if;
  if _decision = 'rejected' and v_note is null then
    raise exception 'verification_rejection_note_required';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'verification_review_note_too_long';
  end if;

  select r.store_id into v_store_id
  from public.store_verification_requests r
  where r.id = _request_id;
  if not found then
    raise exception 'verification_request_not_pending';
  end if;

  -- Lock the store before its request. The profile-change trigger uses the
  -- same lock order, preventing a request/store deadlock during concurrent edits.
  select s.* into v_store
  from public.stores s
  where s.id = v_store_id
  for update;
  if not found then
    raise exception 'merchant_store_not_found';
  end if;

  select r.* into v_request
  from public.store_verification_requests r
  where r.id = _request_id
  for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'verification_request_not_pending';
  end if;

  v_snapshot := jsonb_build_object(
    'name', v_store.name,
    'logo_url', v_store.logo_url,
    'phone', v_store.phone,
    'region_id', v_store.region_id,
    'secondary_region_id', v_store.secondary_region_id,
    'commune', v_store.commune,
    'address_line', v_store.address_line,
    'opening_hours', v_store.opening_hours
  );

  if v_request.profile_snapshot is distinct from v_snapshot then
    update public.store_verification_requests
    set status = 'draft'
    where id = _request_id;

    insert into public.store_verification_audit_events (
      request_id, store_id, actor_id, event_type, details
    ) values (
      _request_id, v_store.id, auth.uid(), 'profile_changed',
      jsonb_build_object('reason', 'profile_snapshot_mismatch')
    );
    return _request_id;
  end if;

  update public.store_verification_requests
  set status = _decision,
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      review_note = v_note
  where id = _request_id;

  update public.stores
  set is_verified = (_decision = 'approved')
  where id = v_store.id;

  insert into public.store_verification_audit_events (
    request_id, store_id, actor_id, event_type, details
  ) values (
    _request_id, v_store.id, auth.uid(), _decision,
    jsonb_build_object('note', v_note)
  );

  return _request_id;
end;
$function$;

revoke all on function public.review_store_verification_request(uuid, text, text)
  from public, anon;
grant execute on function public.review_store_verification_request(uuid, text, text)
  to authenticated;

-- All existing stores must be re-reviewed. No store or commerce data is deleted.
alter table public.stores alter column is_verified set default false;
update public.stores set is_verified = false where is_verified is distinct from false;

drop policy if exists "Merchants create own store" on public.stores;
create policy "Merchants create own store"
  on public.stores for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and public.has_role((select auth.uid()), 'merchant'::public.app_role)
    and is_verified = false
  );

commit;

-- Reviewer assignment is deliberately not exposed to authenticated users.
-- Add an approved reviewer manually through the Supabase SQL Editor after this
-- migration has been reviewed and explicitly approved:
-- insert into public.store_verification_reviewers (user_id)
-- values ('<AUTH_USER_UUID>')
-- on conflict (user_id) do update set is_active = true;
 then
    raise exception 'store_verification_profile_incomplete';
  end if;

  if exists (
    select 1 from public.store_verification_requests r
    where r.store_id = v_store.id and r.status = 'pending'
  ) then
    raise exception 'store_verification_request_pending';
  end if;

  v_snapshot := jsonb_build_object(
    'name', v_store.name,
    'logo_url', v_store.logo_url,
    'phone', v_store.phone,
    'region_id', v_store.region_id,
    'secondary_region_id', v_store.secondary_region_id,
    'commune', v_store.commune,
    'address_line', v_store.address_line,
    'opening_hours', v_store.opening_hours
  );

  insert into public.store_verification_requests (
    store_id, submitted_by, status, profile_snapshot
  ) values (
    v_store.id, auth.uid(), 'pending', v_snapshot
  ) returning id into v_request_id;

  insert into public.store_verification_audit_events (
    request_id, store_id, actor_id, event_type, details
  ) values (
    v_request_id, v_store.id, auth.uid(), 'submitted',
    jsonb_build_object('profile_snapshot', v_snapshot)
  );

  update public.stores set is_verified = false where id = v_store.id;

  return v_request_id;
end;
$function$;

revoke all on function public.submit_store_verification_request() from public, anon;
grant execute on function public.submit_store_verification_request() to authenticated;

create or replace function public.review_store_verification_request(
  _request_id uuid,
  _decision text,
  _note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request public.store_verification_requests;
  v_store public.stores;
  v_snapshot jsonb;
  v_store_id uuid;
  v_note text := nullif(btrim(coalesce(_note, '')), '');
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_store_verification_reviewer() then
    raise exception 'not_authorized';
  end if;
  if _decision is null or _decision not in ('approved', 'rejected') then
    raise exception 'invalid_verification_decision';
  end if;
  if _decision = 'rejected' and v_note is null then
    raise exception 'verification_rejection_note_required';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'verification_review_note_too_long';
  end if;

  select r.store_id into v_store_id
  from public.store_verification_requests r
  where r.id = _request_id;
  if not found then
    raise exception 'verification_request_not_pending';
  end if;

  -- Lock the store before its request. The profile-change trigger uses the
  -- same lock order, preventing a request/store deadlock during concurrent edits.
  select s.* into v_store
  from public.stores s
  where s.id = v_store_id
  for update;
  if not found then
    raise exception 'merchant_store_not_found';
  end if;

  select r.* into v_request
  from public.store_verification_requests r
  where r.id = _request_id
  for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'verification_request_not_pending';
  end if;

  v_snapshot := jsonb_build_object(
    'name', v_store.name,
    'logo_url', v_store.logo_url,
    'phone', v_store.phone,
    'region_id', v_store.region_id,
    'secondary_region_id', v_store.secondary_region_id,
    'commune', v_store.commune,
    'address_line', v_store.address_line,
    'opening_hours', v_store.opening_hours
  );

  if v_request.profile_snapshot is distinct from v_snapshot then
    update public.store_verification_requests
    set status = 'draft'
    where id = _request_id;

    insert into public.store_verification_audit_events (
      request_id, store_id, actor_id, event_type, details
    ) values (
      _request_id, v_store.id, auth.uid(), 'profile_changed',
      jsonb_build_object('reason', 'profile_snapshot_mismatch')
    );
    return _request_id;
  end if;

  update public.store_verification_requests
  set status = _decision,
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      review_note = v_note
  where id = _request_id;

  update public.stores
  set is_verified = (_decision = 'approved')
  where id = v_store.id;

  insert into public.store_verification_audit_events (
    request_id, store_id, actor_id, event_type, details
  ) values (
    _request_id, v_store.id, auth.uid(), _decision,
    jsonb_build_object('note', v_note)
  );

  return _request_id;
end;
$function$;

revoke all on function public.review_store_verification_request(uuid, text, text)
  from public, anon;
grant execute on function public.review_store_verification_request(uuid, text, text)
  to authenticated;

-- All existing stores must be re-reviewed. No store or commerce data is deleted.
alter table public.stores alter column is_verified set default false;
update public.stores set is_verified = false where is_verified is distinct from false;

drop policy if exists "Merchants create own store" on public.stores;
create policy "Merchants create own store"
  on public.stores for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and public.has_role((select auth.uid()), 'merchant'::public.app_role)
    and is_verified = false
  );

commit;

-- Reviewer assignment is deliberately not exposed to authenticated users.
-- Add an approved reviewer manually through the Supabase SQL Editor after this
-- migration has been reviewed and explicitly approved:
-- insert into public.store_verification_reviewers (user_id)
-- values ('<AUTH_USER_UUID>')
-- on conflict (user_id) do update set is_active = true;
