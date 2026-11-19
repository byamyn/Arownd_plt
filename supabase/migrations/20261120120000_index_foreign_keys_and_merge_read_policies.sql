-- Add covering indexes for the remaining foreign keys and consolidate equivalent
-- authenticated SELECT policies without changing their effective access predicates.

create index if not exists country_regions_parent_country_idx
  on public.country_regions (country_code, parent_id);

create index if not exists orders_country_currency_idx
  on public.orders (country_code, currency_code);

create index if not exists profiles_browsing_country_code_idx
  on public.profiles (browsing_country_code);

create index if not exists store_verification_audit_actor_idx
  on public.store_verification_audit_events (actor_id);

create index if not exists store_verification_audit_request_idx
  on public.store_verification_audit_events (request_id);

create index if not exists store_verification_requests_reviewer_idx
  on public.store_verification_requests (reviewed_by);

create index if not exists store_verification_requests_submitter_idx
  on public.store_verification_requests (submitted_by);

create index if not exists store_verification_reviewers_assigned_by_idx
  on public.store_verification_reviewers (assigned_by);

create index if not exists support_conversations_order_idx
  on public.support_conversations (order_id);

drop policy if exists "Creators read own products" on public.products;
drop policy if exists "Products browsing country and owner read" on public.products;
create policy "Products owner creator and market read"
  on public.products
  for select
  to authenticated
  using (
    created_by = (select auth.uid())
    or exists (
      select 1
      from public.store_offers so
      join public.stores s on s.id = so.store_id
      where so.product_id = products.id
        and s.owner_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.store_offers so
      join public.stores s on s.id = so.store_id
      join public.profiles p on p.user_id = (select auth.uid())
      where so.product_id = products.id
        and p.browsing_country_code = s.country_code
    )
  );

drop policy if exists "Authorized reviewers read verification audit" on public.store_verification_audit_events;
drop policy if exists "Store owners read own verification audit" on public.store_verification_audit_events;
create policy "Reviewers and store owners read verification audit"
  on public.store_verification_audit_events
  for select
  to authenticated
  using (
    public.is_store_verification_reviewer()
    or exists (
      select 1
      from public.stores s
      where s.id = store_verification_audit_events.store_id
        and s.owner_id = (select auth.uid())
    )
  );

drop policy if exists "Authorized reviewers read verification requests" on public.store_verification_requests;
drop policy if exists "Store owners read own verification requests" on public.store_verification_requests;
create policy "Reviewers and store owners read verification requests"
  on public.store_verification_requests
  for select
  to authenticated
  using (
    public.is_store_verification_reviewer()
    or exists (
      select 1
      from public.stores s
      where s.id = store_verification_requests.store_id
        and s.owner_id = (select auth.uid())
    )
  );
