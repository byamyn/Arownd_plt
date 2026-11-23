begin;

create table public.team_employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete restrict,
  email text not null,
  full_name text not null,
  job_title text,
  rank text not null default 'Associate'
    check (rank in ('Founder','Executive','Head','Lead','Senior','Specialist','Associate')),
  status text not null default 'invited'
    check (status in ('invited','active','suspended','offboarded')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_employees_email_check check (
    char_length(btrim(email)) between 5 and 254
    and email = lower(btrim(email))
  ),
  constraint team_employees_name_check check (
    char_length(btrim(full_name)) between 1 and 120
  ),
  constraint team_employees_active_identity_check check (
    status <> 'active' or user_id is not null
  )
);
create unique index team_employees_email_unique on public.team_employees (lower(email));

create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.team_employees(id) on delete restrict,
  email text not null,
  invited_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending','accepted','revoked','expired')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint team_invitations_email_check check (
    char_length(btrim(email)) between 5 and 254
    and email = lower(btrim(email))
  )
);
create unique index team_invitations_one_pending_per_employee
  on public.team_invitations (employee_id) where status = 'pending';

create table public.team_roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_en text not null,
  name_ar text not null,
  description text,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint team_roles_code_check check (code ~ '^[a-z][a-z0-9_]{1,63}$')
);

create table public.team_permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  module text not null,
  description text not null,
  created_at timestamptz not null default now(),
  constraint team_permissions_code_check check (code ~ '^[a-z][a-z0-9_.]{1,95}$')
);

create table public.team_employee_roles (
  employee_id uuid not null references public.team_employees(id) on delete restrict,
  role_id uuid not null references public.team_roles(id) on delete restrict,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (employee_id, role_id)
);

create table public.team_role_permissions (
  role_id uuid not null references public.team_roles(id) on delete restrict,
  permission_id uuid not null references public.team_permissions(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create index team_employee_roles_role_idx on public.team_employee_roles (role_id, employee_id);
create index team_role_permissions_permission_idx on public.team_role_permissions (permission_id, role_id);
create index team_invitations_pending_expiry_idx on public.team_invitations (expires_at) where status = 'pending';

insert into public.team_roles (code, name_en, name_ar, description, is_system)
values
  ('founder_ceo', 'Founder & CEO', 'المؤسس والمدير التنفيذي', 'Full platform ownership and control.', true),
  ('platform_admin', 'Platform Admin', 'إدارة المنصة', 'Platform administration within assigned permissions.', true),
  ('customer_care', 'Customer Care', 'خدمة العملاء', 'Customer support and dispute handling.', true),
  ('tech_ops', 'Tech Ops', 'العمليات التقنية', 'Technical operations and platform health.', true)
on conflict (code) do update set
  name_en = excluded.name_en, name_ar = excluded.name_ar,
  description = excluded.description, is_system = true;

insert into public.team_permissions (code, module, description)
values
  ('dashboard.view', 'dashboard', 'View the team dashboard.'),
  ('employees.view', 'employees', 'View employee records.'),
  ('employees.manage', 'employees', 'Create and update employee records.'),
  ('roles.view', 'roles', 'View roles and permissions.'),
  ('roles.manage', 'roles', 'Create and manage custom roles.'),
  ('roles.assign', 'roles', 'Assign eligible roles to employees.'),
  ('support.view', 'support', 'Access the support center.'),
  ('disputes.view', 'disputes', 'View dispute cases.'),
  ('disputes.resolve', 'disputes', 'Resolve dispute cases through the approved workflow.'),
  ('tasks.view', 'tasks', 'View assigned tasks.'),
  ('reports.view', 'reports', 'View team reports.'),
  ('audit.view', 'audit', 'View administrative audit records.'),
  ('settings.view', 'settings', 'View team settings.'),
  ('tech_ops.view', 'tech_ops', 'Access technical operations.')
on conflict (code) do update set module = excluded.module, description = excluded.description;

insert into public.team_role_permissions (role_id, permission_id)
select r.id, p.id from public.team_roles r cross join public.team_permissions p
where r.code = 'founder_ceo' on conflict do nothing;

insert into public.team_role_permissions (role_id, permission_id)
select r.id, p.id from public.team_roles r
join public.team_permissions p on p.code = any (array[
  'dashboard.view','employees.view','employees.manage','roles.view','roles.manage',
  'roles.assign','tasks.view','reports.view','audit.view','settings.view'
])
where r.code = 'platform_admin' on conflict do nothing;

insert into public.team_role_permissions (role_id, permission_id)
select r.id, p.id from public.team_roles r
join public.team_permissions p on p.code = any (array[
  'dashboard.view','support.view','disputes.view','disputes.resolve'
])
where r.code = 'customer_care' on conflict do nothing;

insert into public.team_role_permissions (role_id, permission_id)
select r.id, p.id from public.team_roles r
join public.team_permissions p on p.code = any (array['dashboard.view','tech_ops.view','settings.view'])
where r.code = 'tech_ops' on conflict do nothing;

create or replace function private.has_team_permission(_permission_code text)
returns boolean language sql stable security definer set search_path = ''
as $function$
  select auth.uid() is not null and exists (
    select 1
    from public.team_employees e
    join public.team_employee_roles er on er.employee_id = e.id
    join public.team_roles r on r.id = er.role_id and r.is_active = true
    join public.team_role_permissions rp on rp.role_id = r.id
    join public.team_permissions p on p.id = rp.permission_id
    where e.user_id = auth.uid() and e.status = 'active' and p.code = _permission_code
  );
$function$;

create or replace function private.is_team_employee()
returns boolean language sql stable security definer set search_path = ''
as $function$
  select auth.uid() is not null and exists (
    select 1 from public.team_employees e
    where e.user_id = auth.uid() and e.status = 'active'
  );
$function$;

create or replace function private.is_team_founder()
returns boolean language sql stable security definer set search_path = ''
as $function$
  select auth.uid() is not null and exists (
    select 1 from public.team_employees e
    join public.team_employee_roles er on er.employee_id = e.id
    join public.team_roles r on r.id = er.role_id
    where e.user_id = auth.uid() and e.status = 'active'
      and r.code = 'founder_ceo' and r.is_active = true
  );
$function$;

create or replace function private.is_founder_employee(_employee_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $function$
  select exists (
    select 1 from public.team_employee_roles er
    join public.team_roles r on r.id = er.role_id
    where er.employee_id = _employee_id and r.code = 'founder_ceo'
  );
$function$;

revoke all on function private.has_team_permission(text) from public, anon;
revoke all on function private.is_team_employee() from public, anon;
revoke all on function private.is_team_founder() from public, anon;
revoke all on function private.is_founder_employee(uuid) from public, anon;
grant usage on schema private to authenticated, service_role;
grant execute on function private.has_team_permission(text) to authenticated, service_role;
grant execute on function private.is_team_employee() to authenticated, service_role;
grant execute on function private.is_team_founder() to authenticated, service_role;
grant execute on function private.is_founder_employee(uuid) to authenticated, service_role;

alter table public.team_employees enable row level security;
alter table public.team_invitations enable row level security;
alter table public.team_roles enable row level security;
alter table public.team_permissions enable row level security;
alter table public.team_employee_roles enable row level security;
alter table public.team_role_permissions enable row level security;

revoke all on public.team_employees, public.team_invitations, public.team_roles,
  public.team_permissions, public.team_employee_roles, public.team_role_permissions
from public, anon;
grant select on public.team_employees, public.team_invitations, public.team_roles,
  public.team_permissions, public.team_employee_roles, public.team_role_permissions to authenticated;
grant insert (email, full_name, job_title, rank, status, created_by) on public.team_employees to authenticated;
grant update (email, full_name, job_title, rank, status, updated_at) on public.team_employees to authenticated;
grant insert (employee_id, email, invited_by, status, expires_at) on public.team_invitations to authenticated;
grant update (status, expires_at, revoked_at, accepted_at) on public.team_invitations to authenticated;
grant insert (code, name_en, name_ar, description, is_system, is_active) on public.team_roles to authenticated;
grant update (name_en, name_ar, description, is_active) on public.team_roles to authenticated;
grant delete on public.team_roles to authenticated;
grant insert, delete on public.team_employee_roles to authenticated;
grant insert, delete on public.team_role_permissions to authenticated;
grant all on public.team_employees, public.team_invitations, public.team_roles,
  public.team_permissions, public.team_employee_roles, public.team_role_permissions to service_role;

create policy team_employees_read on public.team_employees for select to authenticated
using (user_id = (select auth.uid()) or (select private.has_team_permission('employees.view')));

create policy team_employees_insert on public.team_employees for insert to authenticated
with check (
  (select private.has_team_permission('employees.manage'))
  and user_id is null and status = 'invited' and rank <> 'Founder'
  and created_by = (select auth.uid())
);

create policy team_employees_update on public.team_employees for update to authenticated
using ((select private.has_team_permission('employees.manage'))
  and not (select private.is_founder_employee(id)))
with check ((select private.has_team_permission('employees.manage'))
  and not (select private.is_founder_employee(id)) and rank <> 'Founder');

create policy team_invitations_read on public.team_invitations for select to authenticated
using ((select private.has_team_permission('employees.view')));

create policy team_invitations_insert on public.team_invitations for insert to authenticated
with check (
  (select private.has_team_permission('employees.manage'))
  and invited_by = (select auth.uid()) and status = 'pending'
  and exists (
    select 1 from public.team_employees e
    where e.id = employee_id and lower(e.email) = lower(email)
      and e.status = 'invited' and e.user_id is null
  )
);

create policy team_invitations_update on public.team_invitations for update to authenticated
using (
  (select private.has_team_permission('employees.manage')) and status = 'pending'
  and exists (select 1 from public.team_employees e
    where e.id = employee_id and not (select private.is_founder_employee(e.id)))
)
with check ((select private.has_team_permission('employees.manage'))
  and status in ('pending','revoked','expired'));

create policy team_roles_read on public.team_roles for select to authenticated
using ((select private.is_team_employee()));

create policy team_roles_insert on public.team_roles for insert to authenticated
with check ((select private.has_team_permission('roles.manage')) and is_system = false);

create policy team_roles_update on public.team_roles for update to authenticated
using ((select private.has_team_permission('roles.manage')) and is_system = false)
with check (is_system = false);

create policy team_roles_delete on public.team_roles for delete to authenticated
using ((select private.has_team_permission('roles.manage')) and is_system = false
  and not exists (select 1 from public.team_employee_roles er where er.role_id = team_roles.id));

create policy team_permissions_read on public.team_permissions for select to authenticated
using ((select private.is_team_employee()));

create policy team_employee_roles_read on public.team_employee_roles for select to authenticated
using ((select private.has_team_permission('roles.view'))
  or exists (select 1 from public.team_employees e
    where e.id = employee_id and e.user_id = (select auth.uid())));

create policy team_employee_roles_insert on public.team_employee_roles for insert to authenticated
with check (
  (select private.has_team_permission('roles.assign'))
  and (
    (select private.is_team_founder())
    or (
      employee_id not in (select e.id from public.team_employees e where e.user_id = (select auth.uid()))
      and exists (select 1 from public.team_roles r where r.id = role_id and r.code <> 'founder_ceo')
    )
  )
  and exists (select 1 from public.team_employees e
    where e.id = employee_id and e.status in ('invited','active'))
);

create policy team_employee_roles_delete on public.team_employee_roles for delete to authenticated
using ((select private.has_team_permission('roles.assign'))
  and ((select private.is_team_founder())
    or (not (select private.is_founder_employee(employee_id))
      and employee_id not in (select e.id from public.team_employees e where e.user_id = (select auth.uid())))));

create policy team_role_permissions_read on public.team_role_permissions for select to authenticated
using ((select private.is_team_employee()));

create policy team_role_permissions_insert on public.team_role_permissions for insert to authenticated
with check (
  (select private.has_team_permission('roles.manage'))
  and (
    (select private.is_team_founder())
    or (
      exists (select 1 from public.team_roles r where r.id = role_id and r.is_system = false)
      and exists (select 1 from public.team_permissions p where p.id = permission_id
        and p.code not in ('employees.manage','roles.manage','roles.assign','disputes.resolve'))
    )
  )
);

create policy team_role_permissions_delete on public.team_role_permissions for delete to authenticated
using ((select private.has_team_permission('roles.manage'))
  and ((select private.is_team_founder())
    or exists (select 1 from public.team_roles r where r.id = role_id and r.is_system = false)));

create or replace function private.sync_team_support_membership(_employee_id uuid, _actor_id uuid default null)
returns void language plpgsql security definer set search_path = ''
as $function$
declare
  v_user_id uuid;
  v_is_active boolean;
begin
  select e.user_id,
         e.status = 'active' and exists (
           select 1 from public.team_employee_roles er
           join public.team_roles r on r.id = er.role_id
           where er.employee_id = e.id and r.code = 'customer_care' and r.is_active = true
         )
  into v_user_id, v_is_active
  from public.team_employees e where e.id = _employee_id;

  if v_user_id is null then return; end if;

  if coalesce(v_is_active, false) then
    insert into public.support_members (user_id, is_active, added_by)
    values (v_user_id, true, _actor_id)
    on conflict (user_id) do update set is_active = true, updated_at = now();
  else
    update public.support_members set is_active = false, updated_at = now()
    where user_id = v_user_id;
  end if;
end;
$function$;

revoke all on function private.sync_team_support_membership(uuid, uuid) from public, anon, authenticated;

create or replace function private.on_team_employee_role_change()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare
  v_employee_id uuid;
  v_actor_id uuid;
begin
  v_employee_id := coalesce(new.employee_id, old.employee_id);
  v_actor_id := coalesce(new.assigned_by, old.assigned_by, auth.uid());
  perform private.sync_team_support_membership(v_employee_id, v_actor_id);
  return coalesce(new, old);
end;
$function$;
revoke all on function private.on_team_employee_role_change() from public, anon, authenticated;

create trigger team_employee_roles_sync_support
after insert or update or delete on public.team_employee_roles
for each row execute function private.on_team_employee_role_change();

create or replace function private.on_team_employee_status_change()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if new.status is distinct from old.status or new.user_id is distinct from old.user_id then
    perform private.sync_team_support_membership(new.id, auth.uid());
  end if;
  return new;
end;
$function$;
revoke all on function private.on_team_employee_status_change() from public, anon, authenticated;

create trigger team_employees_sync_support
after update of status, user_id on public.team_employees
for each row execute function private.on_team_employee_status_change();

commit;
