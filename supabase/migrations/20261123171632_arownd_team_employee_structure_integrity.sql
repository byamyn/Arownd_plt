-- Enforce valid department/team assignments and prevent reporting cycles.
begin;
create or replace function private.validate_team_employee_structure()
returns trigger language plpgsql set search_path=''
as $function$
declare v_cycle boolean;
begin
  if new.team_id is not null then
    if new.department_id is null or not exists(select 1 from public.team_teams t where t.id=new.team_id and t.department_id=new.department_id) then
      raise exception 'team_must_belong_to_employee_department';
    end if;
  end if;
  if new.manager_id is not null then
    if not exists(select 1 from public.team_employees m where m.id=new.manager_id and m.status='active') then
      raise exception 'manager_must_be_active';
    end if;
    with recursive descendants(id) as (
      select e.id from public.team_employees e where e.manager_id=new.id
      union all
      select e.id from public.team_employees e join descendants d on e.manager_id=d.id
    )
    select exists(select 1 from descendants where id=new.manager_id) into v_cycle;
    if v_cycle then raise exception 'manager_hierarchy_cycle'; end if;
  end if;
  return new;
end;
$function$;
revoke all on function private.validate_team_employee_structure() from public,anon,authenticated;
create trigger team_employees_validate_structure
before insert or update of department_id,team_id,manager_id,status on public.team_employees
for each row execute function private.validate_team_employee_structure();
commit;