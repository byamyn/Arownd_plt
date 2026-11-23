-- Dispute chat with buyer, merchant and Arownd support as a limited third party.
-- Support membership is provisioned only by trusted operators outside the mobile app.

begin;

create table if not exists public.support_members (
  user_id uuid primary key references auth.users(id) on delete restrict,
  is_active boolean not null default true,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.support_members enable row level security;
revoke all on public.support_members from public, anon, authenticated;
grant select on public.support_members to authenticated;
grant all on public.support_members to service_role;

drop policy if exists support_members_read_self on public.support_members;
create policy support_members_read_self
  on public.support_members for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.is_current_user_dispute_support()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null and exists (
    select 1 from public.support_members sm
    where sm.user_id = auth.uid() and sm.is_active = true
  );
$function$;

revoke all on function public.is_current_user_dispute_support() from public, anon;
grant execute on function public.is_current_user_dispute_support() to authenticated;

drop policy if exists merchant_order_disputes_read_participants
  on public.merchant_order_disputes;
create policy merchant_order_disputes_read_participants
  on public.merchant_order_disputes
  for select to authenticated
  using (
    customer_id = (select auth.uid())
    or private.is_store_team_member(store_id)
    or (select public.is_current_user_dispute_support())
  );

drop policy if exists merchant_order_completion_events_read_participants
  on public.merchant_order_completion_events;
create policy merchant_order_completion_events_read_participants
  on public.merchant_order_completion_events
  for select to authenticated
  using (
    exists (
      select 1 from public.merchant_orders mo
      where mo.id = merchant_order_completion_events.merchant_order_id
        and (
          mo.customer_id = (select auth.uid())
          or private.is_store_team_member(mo.store_id)
        )
    )
    or exists (
      select 1 from public.merchant_order_disputes d
      where d.merchant_order_id = merchant_order_completion_events.merchant_order_id
        and (select public.is_current_user_dispute_support())
    )
  );

-- Support can inspect only records attached to an existing dispute.
-- These are SELECT policies only; support receives no order mutation permissions.

drop policy if exists "Customers and store team read merchant orders" on public.merchant_orders;
create policy "Customers and store team read merchant orders"
  on public.merchant_orders for select to authenticated
  using (
    customer_id = (select auth.uid())
    or private.is_store_team_member(store_id)
    or exists (
      select 1 from public.merchant_order_disputes d
      where d.merchant_order_id = merchant_orders.id
        and (select public.is_current_user_dispute_support())
    )
  );

drop policy if exists "Order read" on public.orders;
create policy "Order read"
  on public.orders for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_order_merchant(id)
    or exists (
      select 1 from public.merchant_order_disputes d
      where d.order_id = orders.id
        and (select public.is_current_user_dispute_support())
    )
  );

drop policy if exists "Order items read" on public.order_items;
create policy "Order items read"
  on public.order_items for select to authenticated
  using (
    private.is_order_owner(order_id)
    or private.is_store_team_member(store_id)
    or exists (
      select 1 from public.merchant_order_disputes d
      where d.merchant_order_id = order_items.merchant_order_id
        and (select public.is_current_user_dispute_support())
    )
  );

drop policy if exists "Customers and store team read shipments" on public.shipments;
create policy "Customers and store team read shipments"
  on public.shipments for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = shipments.order_id
        and o.user_id = (select auth.uid())
    )
    or (
      merchant_order_id is not null
      and exists (
        select 1 from public.merchant_orders mo
        where mo.id = shipments.merchant_order_id
          and private.is_store_team_member(mo.store_id)
      )
    )
    or exists (
      select 1 from public.merchant_order_disputes d
      where d.merchant_order_id = shipments.merchant_order_id
        and (select public.is_current_user_dispute_support())
    )
  );

drop policy if exists merchant_order_cod_collections_read_participants
  on public.merchant_order_cod_collections;
create policy merchant_order_cod_collections_read_participants
  on public.merchant_order_cod_collections for select to authenticated
  using (
    exists (
      select 1 from public.merchant_orders mo
      where mo.id = merchant_order_cod_collections.merchant_order_id
        and (
          mo.customer_id = (select auth.uid())
          or private.is_store_owner(mo.store_id)
        )
    )
    or exists (
      select 1 from public.merchant_order_disputes d
      where d.merchant_order_id = merchant_order_cod_collections.merchant_order_id
        and (select public.is_current_user_dispute_support())
    )
  );

drop policy if exists merchant_order_tracking_events_read_participants
  on public.merchant_order_tracking_events;
create policy merchant_order_tracking_events_read_participants
  on public.merchant_order_tracking_events for select to authenticated
  using (
    exists (
      select 1 from public.merchant_orders mo
      where mo.id = merchant_order_tracking_events.merchant_order_id
        and (
          mo.customer_id = (select auth.uid())
          or private.is_store_team_member(mo.store_id)
        )
    )
    or exists (
      select 1 from public.merchant_order_disputes d
      where d.merchant_order_id = merchant_order_tracking_events.merchant_order_id
        and (select public.is_current_user_dispute_support())
    )
  );

drop policy if exists "Stores browsing country owner and team read" on public.stores;
create policy "Stores browsing country owner and team read"
  on public.stores for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (select private.is_store_team_member(stores.id))
    or exists (
      select 1 from public.profiles p
      where p.user_id = (select auth.uid())
        and p.browsing_country_code = stores.country_code
    )
    or exists (
      select 1 from public.merchant_order_disputes d
      where d.store_id = stores.id
        and (select public.is_current_user_dispute_support())
    )
  );

alter table public.merchant_order_completion_events
  drop constraint if exists merchant_order_completion_events_action_check;
alter table public.merchant_order_completion_events
  add constraint merchant_order_completion_events_action_check
  check (action = any (array[
    'seller_confirmed_delivery_and_cash',
    'customer_confirmed_receipt_and_payment',
    'customer_opened_dispute',
    'support_resolved_dispute'
  ]));
alter table public.merchant_order_completion_events
  drop constraint if exists merchant_order_completion_events_actor_type_check;
alter table public.merchant_order_completion_events
  add constraint merchant_order_completion_events_actor_type_check
  check (actor_type = any (array['seller','customer','support']));

create index if not exists merchant_order_disputes_active_updated_idx
  on public.merchant_order_disputes(updated_at desc)
  where status in ('open', 'in_review');

create table if not exists public.merchant_order_dispute_messages (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.merchant_order_disputes(id) on delete restrict,
  merchant_order_id uuid not null references public.merchant_orders(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  sender_id uuid not null references auth.users(id) on delete restrict,
  sender_role text not null check (sender_role in ('customer','merchant','support')),
  message text not null default '',
  attachment_path text,
  created_at timestamptz not null default now(),
  constraint merchant_order_dispute_messages_content_check check (
    char_length(btrim(message)) <= 4000
    and (
      char_length(btrim(message)) >= 1
      or attachment_path is not null
    )
  )
);

create index if not exists merchant_order_dispute_messages_recent_idx
  on public.merchant_order_dispute_messages(dispute_id, created_at asc, id asc);
create index if not exists merchant_order_dispute_messages_sender_idx
  on public.merchant_order_dispute_messages(sender_id, created_at desc);
create index if not exists merchant_order_dispute_messages_merchant_order_idx
  on public.merchant_order_dispute_messages(merchant_order_id);
create index if not exists merchant_order_dispute_messages_order_idx
  on public.merchant_order_dispute_messages(order_id);
create index if not exists support_members_added_by_idx
  on public.support_members(added_by)
  where added_by is not null;

alter table public.merchant_order_dispute_messages enable row level security;
revoke all on public.merchant_order_dispute_messages from public, anon, authenticated;
grant select, insert on public.merchant_order_dispute_messages to authenticated;

drop policy if exists merchant_order_dispute_messages_read_participants
  on public.merchant_order_dispute_messages;
create policy merchant_order_dispute_messages_read_participants
  on public.merchant_order_dispute_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.merchant_order_disputes d
      where d.id = dispute_id
        and (
          d.customer_id = (select auth.uid())
          or private.is_store_team_member(d.store_id)
          or (select public.is_current_user_dispute_support())
        )
    )
  );

drop policy if exists merchant_order_dispute_messages_insert_participants
  on public.merchant_order_dispute_messages;
create policy merchant_order_dispute_messages_insert_participants
  on public.merchant_order_dispute_messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1
      from public.merchant_order_disputes d
      where d.id = dispute_id
        and d.merchant_order_id = merchant_order_dispute_messages.merchant_order_id
        and d.order_id = merchant_order_dispute_messages.order_id
        and d.status <> 'resolved'
        and (
          (sender_role = 'customer' and d.customer_id = (select auth.uid()))
          or (sender_role = 'merchant' and private.is_store_team_member(d.store_id))
          or (sender_role = 'support' and (select public.is_current_user_dispute_support()))
        )
        and (
          attachment_path is null
          or attachment_path like d.id::text || '/' || (select auth.uid())::text || '/%'
        )
    )
  );



create or replace function public.populate_merchant_order_dispute_message_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_dispute public.merchant_order_disputes;
begin
  select d.* into v_dispute
  from public.merchant_order_disputes d
  where d.id = new.dispute_id;
  if not found then raise exception 'dispute_not_found'; end if;

  new.merchant_order_id := v_dispute.merchant_order_id;
  new.order_id := v_dispute.order_id;
  return new;
end;
$function$;

revoke all on function public.populate_merchant_order_dispute_message_context()
  from public, anon, authenticated;

drop trigger if exists merchant_order_dispute_messages_context_before_insert
  on public.merchant_order_dispute_messages;
create trigger merchant_order_dispute_messages_context_before_insert
  before insert on public.merchant_order_dispute_messages
  for each row execute function public.populate_merchant_order_dispute_message_context();

create or replace function public.current_user_merchant_order_dispute_role(_dispute_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_dispute public.merchant_order_disputes;
begin
  if auth.uid() is null then return null; end if;
  select d.* into v_dispute
  from public.merchant_order_disputes d
  where d.id = _dispute_id;
  if not found then return null; end if;

  if v_dispute.customer_id = auth.uid() then return 'customer'; end if;
  if private.is_store_team_member(v_dispute.store_id) then return 'merchant'; end if;
  if public.is_current_user_dispute_support() then return 'support'; end if;
  return null;
end;
$function$;

revoke all on function public.current_user_merchant_order_dispute_role(uuid)
  from public, anon;
grant execute on function public.current_user_merchant_order_dispute_role(uuid)
  to authenticated;

create or replace function public.handle_merchant_order_dispute_message_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_dispute public.merchant_order_disputes;
  v_title text;
  v_body text;
  v_route text;
begin
  select d.* into v_dispute
  from public.merchant_order_disputes d
  where d.id = new.dispute_id
  for update;

  if not found then
    raise exception 'dispute_not_found';
  end if;

  -- The row lock closes the race with support resolution: a message that
  -- waited behind the resolve transaction is rejected after it sees resolved.
  if v_dispute.status = 'resolved' then
    raise exception 'dispute_resolved';
  end if;

  if new.sender_role = 'support' and v_dispute.status = 'open' then
    update public.merchant_order_disputes
    set status = 'in_review', updated_at = now()
    where id = v_dispute.id;
  else
    update public.merchant_order_disputes
    set updated_at = now()
    where id = v_dispute.id;
  end if;

  v_title := case new.sender_role
    when 'support' then 'رسالة جديدة من دعم Arownd'
    when 'merchant' then 'رد جديد من المتجر'
    else 'رسالة جديدة من المشتري'
  end;
  v_body := case
    when nullif(btrim(new.message), '') is not null then left(new.message, 180)
    else 'تم إرفاق ملف جديد في محادثة النزاع.'
  end;

  insert into public.notifications(user_id, type, title, body, data)
  select recipient.user_id, 'order', v_title, v_body,
    jsonb_build_object(
      'kind', 'merchant_order_dispute_message',
      'dispute_id', new.dispute_id,
      'merchant_order_id', new.merchant_order_id,
      'order_id', new.order_id,
      'url', '/disputes/' || new.dispute_id::text
    )
  from (
    select v_dispute.customer_id as user_id
    union
    select stm.user_id
    from public.store_team_members stm
    where stm.store_id = v_dispute.store_id
    union
    select st.owner_id
    from public.stores st
    where st.id = v_dispute.store_id and st.owner_id is not null
  ) recipient
  where recipient.user_id <> new.sender_id;

  return new;
end;
$function$;

revoke all on function public.handle_merchant_order_dispute_message_insert()
  from public, anon, authenticated;

drop trigger if exists merchant_order_dispute_messages_after_insert
  on public.merchant_order_dispute_messages;
create trigger merchant_order_dispute_messages_after_insert
  after insert on public.merchant_order_dispute_messages
  for each row execute function public.handle_merchant_order_dispute_message_insert();

create or replace function public.support_resolve_merchant_order_dispute(
  _dispute_id uuid,
  _resolution_note text
)
returns public.merchant_order_disputes
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_dispute public.merchant_order_disputes;
  v_note text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_current_user_dispute_support() then
    raise exception 'support_access_required';
  end if;

  v_note := nullif(btrim(_resolution_note), '');
  if v_note is null or char_length(v_note) > 2000 then
    raise exception 'invalid_resolution_note';
  end if;

  select d.* into v_dispute
  from public.merchant_order_disputes d
  where d.id = _dispute_id
  for update;
  if not found then
    raise exception 'dispute_not_found';
  end if;
  if v_dispute.status = 'resolved' then
    return v_dispute;
  end if;

  update public.merchant_order_disputes
  set status = 'resolved',
      resolution_note = v_note,
      resolved_by = auth.uid(),
      resolved_at = now(),
      updated_at = now()
  where id = _dispute_id
  returning * into v_dispute;

  -- Resolution only releases the order back to its normal dual-confirmation
  -- flow. It does not change fulfillment, prices, COD collection or payment data.
  update public.merchant_orders
  set completion_status = 'pending',
      disputed_at = null,
      dispute_opened_by = null,
      dispute_reason = null,
      updated_at = now()
  where id = v_dispute.merchant_order_id
    and completion_status = 'disputed';

  insert into public.merchant_order_completion_events(
    merchant_order_id, order_id, action, actor_id, actor_type, reason
  ) values (
    v_dispute.merchant_order_id, v_dispute.order_id,
    'support_resolved_dispute', auth.uid(), 'support', v_note
  );

  insert into public.notifications(user_id, type, title, body, data)
  select recipient.user_id, 'order', 'تمت معالجة النزاع',
    left(v_note, 180),
    jsonb_build_object(
      'kind', 'merchant_order_dispute_resolved',
      'dispute_id', v_dispute.id,
      'merchant_order_id', v_dispute.merchant_order_id,
      'order_id', v_dispute.order_id,
      'url', '/disputes/' || v_dispute.id::text
    )
  from (
    select v_dispute.customer_id as user_id
    union
    select stm.user_id from public.store_team_members stm
    where stm.store_id = v_dispute.store_id
  ) recipient
  where recipient.user_id <> auth.uid();

  return v_dispute;
end;
$function$;

revoke all on function public.support_resolve_merchant_order_dispute(uuid, text)
  from public, anon;
grant execute on function public.support_resolve_merchant_order_dispute(uuid, text)
  to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'merchant-order-disputes',
  'merchant-order-disputes',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists merchant_order_dispute_attachments_read
  on storage.objects;
create policy merchant_order_dispute_attachments_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'merchant-order-disputes'
    and exists (
      select 1 from public.merchant_order_disputes d
      where d.id::text = split_part(name, '/', 1)
        and (
          d.customer_id = (select auth.uid())
          or private.is_store_team_member(d.store_id)
          or (select public.is_current_user_dispute_support())
        )
    )
  );

drop policy if exists merchant_order_dispute_attachments_insert
  on storage.objects;
create policy merchant_order_dispute_attachments_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'merchant-order-disputes'
    and split_part(name, '/', 2) = (select auth.uid())::text
    and exists (
      select 1 from public.merchant_order_disputes d
      where d.id::text = split_part(name, '/', 1)
        and d.status <> 'resolved'
        and (
          d.customer_id = (select auth.uid())
          or private.is_store_team_member(d.store_id)
          or (select public.is_current_user_dispute_support())
        )
    )
  );

do $realtime$
begin
  alter publication supabase_realtime add table public.merchant_order_dispute_messages;
exception when duplicate_object then null;
end $realtime$;

do $realtime$
begin
  alter publication supabase_realtime add table public.merchant_order_disputes;
exception when duplicate_object then null;
end $realtime$;

alter table public.merchant_order_dispute_messages replica identity full;

comment on table public.support_members is
  'Arownd dispute-support membership. Membership is provisioned only by trusted operators outside the mobile app.';
comment on table public.merchant_order_dispute_messages is
  'Append-only buyer, merchant and Arownd support chat for one merchant-order dispute.';


-- Notify active support members as soon as a new dispute is opened.
create or replace function public.customer_open_merchant_order_dispute(
  _merchant_order_id uuid,
  _reason text
)
returns public.merchant_orders
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.merchant_orders;
  v_reason text;
  v_dispute_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  v_reason := nullif(trim(_reason), '');
  if v_reason is null or length(v_reason) > 1000 then
    raise exception 'invalid_dispute_reason';
  end if;

  select mo.* into v_order
  from public.merchant_orders mo
  where mo.id = _merchant_order_id
  for update;

  if not found then raise exception 'merchant_order_not_found'; end if;
  if v_order.customer_id <> auth.uid() then raise exception 'not_authorized'; end if;
  if v_order.completion_status = 'completed' then raise exception 'merchant_order_already_completed'; end if;
  if v_order.status = 'cancelled' then raise exception 'merchant_order_not_disputable'; end if;
  select d.id into v_dispute_id
  from public.merchant_order_disputes d
  where d.merchant_order_id = v_order.id;

  if found then
    if v_order.completion_status <> 'disputed' then
      update public.merchant_orders
      set completion_status = 'disputed',
          disputed_at = coalesce(disputed_at, now()),
          dispute_opened_by = coalesce(dispute_opened_by, auth.uid()),
          dispute_reason = coalesce(nullif(trim(dispute_reason), ''), v_reason),
          updated_at = now()
      where id = v_order.id
      returning * into v_order;
    end if;
    return v_order;
  end if;

  if v_order.completion_status = 'disputed' then
    v_reason := coalesce(nullif(trim(v_order.dispute_reason), ''), v_reason);
  end if;

  insert into public.merchant_order_disputes (
    merchant_order_id, order_id, store_id, customer_id, opened_by, reason
  ) values (
    v_order.id, v_order.order_id, v_order.store_id,
    v_order.customer_id, coalesce(v_order.dispute_opened_by, auth.uid()), v_reason
  ) returning id into v_dispute_id;

  update public.merchant_orders
  set completion_status = 'disputed',
      disputed_at = now(),
      dispute_opened_by = auth.uid(),
      dispute_reason = v_reason,
      updated_at = now()
  where id = _merchant_order_id
  returning * into v_order;

  if not exists (
    select 1
    from public.merchant_order_completion_events e
    where e.merchant_order_id = v_order.id
      and e.action = 'customer_opened_dispute'
  ) then
    insert into public.merchant_order_completion_events (
      merchant_order_id, order_id, action, actor_id, actor_type, reason
    ) values (
      v_order.id, v_order.order_id, 'customer_opened_dispute',
      coalesce(v_order.dispute_opened_by, auth.uid()), 'customer', v_reason
    );
  end if;

  insert into public.notifications (user_id, type, title, body, data)
  select recipient.user_id, 'order', 'تم فتح نزاع على الطلب',
    'فتح المشتري نزاعاً على الطلب ويحتاج إلى المراجعة.',
    jsonb_build_object(
      'order_id', v_order.order_id,
      'merchant_order_id', v_order.id,
      'dispute_id', v_dispute_id,
      'completion_status', 'disputed',
      'url', '/disputes/' || v_dispute_id::text
    )
  from (
    select st.owner_id as user_id
    from public.stores st
    where st.id = v_order.store_id and st.owner_id is not null
    union
    select stm.user_id
    from public.store_team_members stm
    where stm.store_id = v_order.store_id
    union
    select sm.user_id
    from public.support_members sm
    where sm.is_active = true
  ) recipient
  where recipient.user_id <> auth.uid();

  return v_order;
end;
$function$;

revoke all on function public.customer_open_merchant_order_dispute(uuid, text)
  from public, anon;
grant execute on function public.customer_open_merchant_order_dispute(uuid, text)
  to authenticated;

commit;
