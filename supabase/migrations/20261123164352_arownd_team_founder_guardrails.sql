begin;

drop policy if exists team_employee_roles_insert on public.team_employee_roles;
create policy team_employee_roles_insert
  on public.team_employee_roles for insert to authenticated
  with check (
    (select private.has_team_permission('roles.assign'))
    and exists (
      select 1 from public.team_roles r
      where r.id = role_id and r.code <> 'founder_ceo'
    )
    and (
      (select private.is_team_founder())
      or employee_id not in (
        select e.id from public.team_employees e
        where e.user_id = (select auth.uid())
      )
    )
    and exists (
      select 1 from public.team_employees e
      where e.id = employee_id and e.status in ('invited','active')
    )
  );

drop policy if exists team_employee_roles_delete on public.team_employee_roles;
create policy team_employee_roles_delete
  on public.team_employee_roles for delete to authenticated
  using (
    (select private.has_team_permission('roles.assign'))
    and exists (
      select 1 from public.team_roles r
      where r.id = role_id and r.code <> 'founder_ceo'
    )
    and (
      (select private.is_team_founder())
      or (
        not (select private.is_founder_employee(employee_id))
        and employee_id not in (
          select e.id from public.team_employees e
          where e.user_id = (select auth.uid())
        )
      )
    )
  );

drop policy if exists team_role_permissions_insert on public.team_role_permissions;
create policy team_role_permissions_insert
  on public.team_role_permissions for insert to authenticated
  with check (
    (select private.has_team_permission('roles.manage'))
    and exists (
      select 1 from public.team_roles r
      where r.id = role_id and r.code <> 'founder_ceo'
        and (
          (select private.is_team_founder())
          or (
            r.is_system = false
            and exists (
              select 1 from public.team_permissions p
              where p.id = permission_id
                and p.code not in (
                  'employees.manage','roles.manage','roles.assign','disputes.resolve'
                )
            )
          )
        )
    )
  );

drop policy if exists team_role_permissions_delete on public.team_role_permissions;
create policy team_role_permissions_delete
  on public.team_role_permissions for delete to authenticated
  using (
    (select private.has_team_permission('roles.manage'))
    and exists (
      select 1 from public.team_roles r
      where r.id = role_id and r.code <> 'founder_ceo'
        and (
          (select private.is_team_founder())
          or r.is_system = false
        )
    )
  );

create or replace function private.on_team_employee_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_employee_id uuid;
  v_actor_id uuid;
begin
  if tg_op = 'DELETE' then
    v_employee_id := old.employee_id;
    v_actor_id := coalesce(old.assigned_by, auth.uid());
    perform private.sync_team_support_membership(v_employee_id, v_actor_id);
    return old;
  end if;

  v_employee_id := new.employee_id;
  v_actor_id := coalesce(new.assigned_by, auth.uid());
  perform private.sync_team_support_membership(v_employee_id, v_actor_id);
  return new;
end;
$function$;

revoke all on function private.on_team_employee_role_change()
  from public, anon, authenticated;

commit;
