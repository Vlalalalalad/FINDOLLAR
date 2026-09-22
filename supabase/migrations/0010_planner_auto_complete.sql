-- Opt-in automatic completion. No existing plan or financial record is changed.
begin;
alter table public.tasks add column if not exists auto_complete boolean not null default false;

create or replace function public.planner_valid_patch(patch jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare legacy jsonb; item jsonb; labels text[];
begin
  if patch is null or jsonb_typeof(patch) <> 'object' then return false; end if;
  if patch ? 'auto_complete' and jsonb_typeof(patch->'auto_complete') <> 'boolean' then return false; end if;
  if patch ? 'tags' then
    if jsonb_typeof(patch->'tags') <> 'array' then return false; end if;
    for item in select value from jsonb_array_elements(patch->'tags') loop
      if jsonb_typeof(item) <> 'string' then return false; end if;
    end loop;
    labels := array(select jsonb_array_elements_text(patch->'tags'));
    if not public.planner_valid_tags(labels) then return false; end if;
  end if;
  legacy := patch - array['tags', 'auto_complete'];
  if legacy->>'priority' = 'none' then legacy := jsonb_set(legacy, '{priority}', '"low"'); end if;
  return public.planner_valid_patch_base(legacy);
exception when others then return false;
end;
$$;

create or replace function public.create_planner_task(p_id uuid, p_task jsonb, p_user_id uuid, p_completion_date date default null)
returns public.tasks language plpgsql security invoker set search_path = public as $$
declare saved public.tasks; rule jsonb; offsets integer[]; requested_status text;
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() then raise exception 'Not authenticated'; end if;
  if p_task is null or jsonb_typeof(p_task) <> 'object'
    or not (p_task ?& array['title', 'status', 'priority', 'color', 'reminders', 'recurrence'])
    or not public.planner_valid_patch(p_task - array['recurrence', 'status'])
  then raise exception 'Invalid task'; end if;
  requested_status := p_task->>'status';
  if requested_status not in ('planned', 'completed') or requested_status is null then raise exception 'Invalid status'; end if;
  rule := nullif(p_task->'recurrence', 'null'::jsonb);
  select coalesce(array_agg(value::integer), '{}') into offsets
    from jsonb_array_elements_text(coalesce(p_task->'reminders', '[]'::jsonb));
  insert into public.tasks (
    id, user_id, title, description, date, time, duration_minutes, status, priority,
    color, reminders, recurrence, recurrence_rule, date_initialized, tags, auto_complete
  ) values (
    p_id, auth.uid(), btrim(p_task->>'title'), coalesce(p_task->>'description', ''),
    (p_task->>'date')::date, (p_task->>'time')::time, (p_task->>'duration_minutes')::integer,
    case when requested_status = 'completed' and rule is null then 'done' else 'planned' end,
    p_task->>'priority', p_task->>'color', offsets, coalesce(rule->>'frequency', 'none'), rule, true,
    array(select jsonb_array_elements_text(coalesce(p_task->'tags', '[]'::jsonb))),
    coalesce((p_task->>'auto_complete')::boolean, false)
  ) on conflict (id) do nothing returning * into saved;
  if saved.id is null then
    select * into saved from public.tasks where id = p_id and user_id = auth.uid();
    if saved.id is null then raise exception 'Task not found'; end if;
    return saved;
  end if;
  if rule is not null and requested_status = 'completed' then
    if not public.planner_occurs_on(saved.date, rule, p_completion_date) then raise exception 'Invalid completion date'; end if;
    insert into public.task_overrides (user_id, task_id, occurrence_date, status)
      values (auth.uid(), saved.id, p_completion_date, 'completed');
  end if;
  return saved;
end;
$$;
revoke all on function public.create_planner_task(uuid, jsonb, uuid, date) from public;
grant execute on function public.create_planner_task(uuid, jsonb, uuid, date) to authenticated;

-- A single atomic compare-and-complete; late requests cannot overwrite a move,
-- deletion, completed status or an opt-out made in another tab.
create or replace function public.auto_complete_planner_occurrence(
  p_task_id uuid, p_occurrence_date date, p_expected_updated_at timestamptz,
  p_timezone text, p_user_id uuid
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare template public.tasks; previous public.task_overrides; saved public.task_overrides;
  effective_date date; effective_time time; duration integer; enabled boolean;
  end_at timestamptz; recurring boolean;
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() then raise exception 'Not authenticated'; end if;
  if p_timezone is null or not exists (select 1 from pg_timezone_names where name = p_timezone) then raise exception 'Invalid timezone'; end if;
  select * into template from public.tasks where id = p_task_id and user_id = auth.uid() for update;
  if template.id is null then return null; end if;
  if p_occurrence_date is not null then
    select * into previous from public.task_overrides where task_id = p_task_id and occurrence_date = p_occurrence_date for update;
  end if;
  recurring := template.recurrence_rule is not null or previous.id is not null;
  if recurring then
    if p_occurrence_date is null or previous.deleted or previous.status = 'completed' then return null; end if;
    if previous.id is null and not public.planner_occurs_on(template.date, template.recurrence_rule, p_occurrence_date) then return null; end if;
    if coalesce(previous.updated_at, template.updated_at) is distinct from p_expected_updated_at then return null; end if;
    effective_date := case when previous.patch ? 'date' then (previous.patch->>'date')::date else p_occurrence_date end;
  else
    if p_occurrence_date is not null or template.status = 'done' or template.updated_at is distinct from p_expected_updated_at then return null; end if;
    effective_date := template.date;
  end if;
  enabled := case when previous.patch ? 'auto_complete' then (previous.patch->>'auto_complete')::boolean else template.auto_complete end;
  effective_time := case when previous.patch ? 'time' then (previous.patch->>'time')::time else template.time end;
  duration := case when previous.patch ? 'duration_minutes' then (previous.patch->>'duration_minutes')::integer else template.duration_minutes end;
  if not enabled or effective_date is null or effective_time is null then return null; end if;
  end_at := (effective_date + effective_time + make_interval(mins => coalesce(duration, 0))) at time zone p_timezone;
  if end_at > clock_timestamp() then return null; end if;
  if recurring then
    saved := public.save_planner_occurrence(template.id, p_occurrence_date, '{}'::jsonb, 'completed', null, p_user_id);
    return jsonb_build_object('override', to_jsonb(saved));
  end if;
  update public.tasks set status = 'done' where id = template.id and user_id = auth.uid() returning * into template;
  return jsonb_build_object('task', to_jsonb(template));
end;
$$;
revoke all on function public.auto_complete_planner_occurrence(uuid, date, timestamptz, text, uuid) from public;
grant execute on function public.auto_complete_planner_occurrence(uuid, date, timestamptz, text, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
