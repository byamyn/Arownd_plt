-- Arownd Team: organization, tasks, audit trail and staff support permissions.
-- Additive migration. Existing buyer, merchant, order and dispute data is preserved.

begin;

create table if not exists public.team_departments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  description text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.team_teams (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.team_departments(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 2 and 100),
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  description text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, code)
);

alter table public.team_employees
  add column if not exists department_id uuid references public.team_departments(id) on delete set null,
  add column if not exists team_id uuid references public.team_teams(id) on delete set null,
  add column if not exists manager_id uuid references public.team_employees(id) on delete set null,
  add column if not exists phone text,
  add column if not exists notes text;

alter table public.team_employees drop constraint if exists team_employees_manager_not_self;
alter table public.team_employees add constraint team_employees_manager_not_self
check (manager_id is null or manager_id <> id);

create table if not exists public.team_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  description text check (description is null or char_length(description) <= 5000),
  assigned_employee_id uuid references public.team_employees(id) on delete set null,
  department_id uuid references public.team_departments(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'new' check (status in ('new','in_progress','review','completed','cancelled')),
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.team_task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.team_tasks(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (char_length(btrim(body)) between 1 and 3000),
  created_at timestamptz not null default now()
);

create table if not exists public.team_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists team_employees_department_idx on public.team_employees(department_id);
create index if not exists team_employees_team_idx on public.team_employees(team_id);
create index if not exists team_employees_manager_idx on public.team_employees(manager_id);
create index if not exists team_teams_department_idx on public.team_teams(department_id);
create index if not exists team_tasks_status_due_idx on public.team_tasks(status, due_at);
create index if not exists team_tasks_assignee_idx on public.team_tasks(assigned_employee_id, status);
create index if not exists team_tasks_department_idx on public.team_tasks(department_id, status);
create index if not exists team_task_comments_task_idx on public.team_task_comments(task_id, created_at);
create index if not exists team_audit_logs_created_idx on public.team_audit_logs(created_at desc);
create index if not exists team_audit_logs_entity_idx on public.team_audit_logs(entity_type, entity_id, created_at desc);

insert into public.team_permissions(code,module,description)
values
 ('org.view','organization','View departments, teams and reporting structure.'),
 ('org.manage','organization','Create and update departments, teams and reporting structure.'),
 ('tasks.manage','tasks','Create, assign and manage team tasks.'),
 ('support.reply','support','Reply to customer support conversations.')
on conflict (code) do nothing;

insert into public.team_role_permissions(role_id,permission_id)
select r.id,p.id from public.team_roles r cross join public.team_permissions p
where r.code='founder_ceo'
   or (r.code='platform_admin' and p.code in ('org.view','org.manage','tasks.manage'))
   or (r.code='customer_care' and p.code='support.reply')
on conflict do nothing;

alter table public.team_departments enable row level security;
alter table public.team_teams enable row level security;
alter table public.team_tasks enable row level security;
alter table public.team_task_comments enable row level security;
alter table public.team_audit_logs enable row level security;

revoke all on public.team_departments,public.team_teams,public.team_tasks,public.team_task_comments,public.team_audit_logs from anon,public;
grant select,insert,update on public.team_departments,public.team_teams to authenticated;
grant select,insert,update on public.team_tasks to authenticated;
grant select,insert on public.team_task_comments to authenticated;
grant select on public.team_audit_logs to authenticated;

create policy team_departments_read on public.team_departments for select to authenticated
using (private.has_team_permission('org.view') or private.has_team_permission('org.manage'));
create policy team_departments_insert on public.team_departments for insert to authenticated
with check (private.has_team_permission('org.manage'));
create policy team_departments_update on public.team_departments for update to authenticated
using (private.has_team_permission('org.manage')) with check (private.has_team_permission('org.manage'));

create policy team_teams_read on public.team_teams for select to authenticated
using (private.has_team_permission('org.view') or private.has_team_permission('org.manage'));
create policy team_teams_insert on public.team_teams for insert to authenticated
with check (private.has_team_permission('org.manage'));
create policy team_teams_update on public.team_teams for update to authenticated
using (private.has_team_permission('org.manage')) with check (private.has_team_permission('org.manage'));

create policy team_tasks_read on public.team_tasks for select to authenticated
using (
  private.has_team_permission('tasks.manage')
  or (private.has_team_permission('tasks.view') and (
    assigned_employee_id in (select e.id from public.team_employees e where e.user_id=auth.uid())
    or department_id in (select e.department_id from public.team_employees e where e.user_id=auth.uid() and e.department_id is not null)
  ))
);
create policy team_tasks_insert on public.team_tasks for insert to authenticated
with check (private.has_team_permission('tasks.manage') and created_by=auth.uid());
create policy team_tasks_update on public.team_tasks for update to authenticated
using (
  private.has_team_permission('tasks.manage')
  or (private.has_team_permission('tasks.view') and assigned_employee_id in (select e.id from public.team_employees e where e.user_id=auth.uid()))
)
with check (
  private.has_team_permission('tasks.manage')
  or (private.has_team_permission('tasks.view') and assigned_employee_id in (select e.id from public.team_employees e where e.user_id=auth.uid()))
);

create policy team_task_comments_read on public.team_task_comments for select to authenticated
using (exists(select 1 from public.team_tasks t where t.id=task_id and (
  private.has_team_permission('tasks.manage')
  or (private.has_team_permission('tasks.view') and (
    t.assigned_employee_id in (select e.id from public.team_employees e where e.user_id=auth.uid())
    or t.department_id in (select e.department_id from public.team_employees e where e.user_id=auth.uid() and e.department_id is not null)
  ))
)));
create policy team_task_comments_insert on public.team_task_comments for insert to authenticated
with check (author_id=auth.uid() and exists(select 1 from public.team_tasks t where t.id=task_id and (
  private.has_team_permission('tasks.manage')
  or t.assigned_employee_id in (select e.id from public.team_employees e where e.user_id=auth.uid())
)));

create policy team_audit_logs_read on public.team_audit_logs for select to authenticated
using (private.has_team_permission('audit.view'));

create or replace function private.write_team_audit_log()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_row jsonb; v_id uuid; v_entity text:=tg_table_name; v_action text:=lower(tg_op);
begin
  if tg_op='DELETE' then v_row:=to_jsonb(old); else v_row:=to_jsonb(new); end if;
  v_id:=nullif(v_row->>'id','')::uuid;
  insert into public.team_audit_logs(actor_id,action,entity_type,entity_id,summary,metadata)
  values(auth.uid(),v_action,v_entity,v_id,
    case tg_op when 'INSERT' then 'Created '||v_entity when 'UPDATE' then 'Updated '||v_entity else 'Deleted '||v_entity end,
    jsonb_build_object(
      'before',case when tg_op in ('UPDATE','DELETE') then to_jsonb(old)-'invite_token_hash' else null end,
      'after',case when tg_op in ('INSERT','UPDATE') then to_jsonb(new)-'invite_token_hash' else null end
    ));
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;
revoke all on function private.write_team_audit_log() from public,anon,authenticated;

create trigger team_employees_audit after insert or update or delete on public.team_employees for each row execute function private.write_team_audit_log();
create trigger team_employee_roles_audit after insert or update or delete on public.team_employee_roles for each row execute function private.write_team_audit_log();
create trigger team_roles_audit after insert or update or delete on public.team_roles for each row execute function private.write_team_audit_log();
create trigger team_role_permissions_audit after insert or update or delete on public.team_role_permissions for each row execute function private.write_team_audit_log();
create trigger team_invitations_audit after insert or update or delete on public.team_invitations for each row execute function private.write_team_audit_log();
create trigger team_departments_audit after insert or update or delete on public.team_departments for each row execute function private.write_team_audit_log();
create trigger team_teams_audit after insert or update or delete on public.team_teams for each row execute function private.write_team_audit_log();
create trigger team_tasks_audit after insert or update or delete on public.team_tasks for each row execute function private.write_team_audit_log();

commit;
