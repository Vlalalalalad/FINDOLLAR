-- Additive planner metadata. Existing priorities, task IDs and exceptions remain intact.
begin;
alter table public.tasks add column if not exists tags text[] not null default '{}';
alter table public.tasks drop constraint if exists tasks_priority_check;
alter table public.tasks add constraint tasks_priority_check check (priority in ('none','low','medium','high'));
alter table public.tasks alter column priority set default 'none';

create or replace function public.planner_valid_tags(tags text[])
returns boolean language sql immutable set search_path = public as $$
  select tags is not null and cardinality(tags) <= 20
    and array_position(tags, null) is null
    and not exists (select 1 from unnest(tags) tag where length(btrim(tag)) not between 1 and 40 or tag <> btrim(tag))
    and cardinality(tags) = (select count(distinct tag) from unnest(tags) tag);
$$;
alter table public.tasks add constraint tasks_planner_tags check (public.planner_valid_tags(tags));

create or replace function public.planner_valid_patch_base(patch jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare parsed_date date; parsed_time time; offsets integer[]; item jsonb;
begin
  if patch is null or jsonb_typeof(patch) <> 'object'
    or patch - array['title', 'description', 'date', 'time', 'duration_minutes', 'priority', 'color', 'reminders'] <> '{}'::jsonb
  then return false; end if;
  if patch ? 'title' and (jsonb_typeof(patch->'title') <> 'string' or length(btrim(patch->>'title')) not between 1 and 200) then return false; end if;
  if patch ? 'description' and patch->'description' <> 'null'::jsonb and (jsonb_typeof(patch->'description') <> 'string' or length(patch->>'description') > 10000) then return false; end if;
  if patch ? 'date' and patch->'date' <> 'null'::jsonb then
    if jsonb_typeof(patch->'date') <> 'string' or (patch->>'date') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
    parsed_date := (patch->>'date')::date;
    if extract(year from parsed_date) not between 1 and 9999 then return false; end if;
  end if;
  if patch ? 'time' and patch->'time' <> 'null'::jsonb then
    if jsonb_typeof(patch->'time') <> 'string' or (patch->>'time') !~ '^([01]\d|2[0-3]):[0-5]\d$' then return false; end if;
    parsed_time := (patch->>'time')::time;
  end if;
  if patch ? 'duration_minutes' and patch->'duration_minutes' <> 'null'::jsonb and
    (jsonb_typeof(patch->'duration_minutes') <> 'number' or (patch->>'duration_minutes') !~ '^\d+$' or (patch->>'duration_minutes')::integer not between 1 and 10080) then return false; end if;
  if patch ? 'priority' and coalesce(patch->>'priority', '') not in ('low', 'medium', 'high') then return false; end if;
  if patch ? 'color' and (jsonb_typeof(patch->'color') <> 'string' or (patch->>'color') !~ '^#[0-9a-fA-F]{6}$') then return false; end if;
  if patch ? 'reminders' then
    if jsonb_typeof(patch->'reminders') <> 'array' then return false; end if;
    for item in select value from jsonb_array_elements(patch->'reminders') loop
      if jsonb_typeof(item) <> 'number' or item::text !~ '^\d+$' then return false; end if;
    end loop;
    select coalesce(array_agg(value::integer), '{}') into offsets from jsonb_array_elements_text(patch->'reminders');
    if not public.planner_valid_reminders(offsets) then return false; end if;
  end if;
  return true;
exception when others then return false;
end;
$$;


-- Retain the original validation contract, adding only tags and an unset priority.
create or replace function public.planner_valid_patch(patch jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare legacy jsonb; item jsonb; labels text[];
begin
  if patch is null or jsonb_typeof(patch) <> 'object' then return false; end if;
  if patch ? 'tags' then
    if jsonb_typeof(patch->'tags') <> 'array' then return false; end if;
    for item in select value from jsonb_array_elements(patch->'tags') loop
      if jsonb_typeof(item) <> 'string' then return false; end if;
    end loop;
    labels := array(select jsonb_array_elements_text(patch->'tags'));
    if not public.planner_valid_tags(labels) then return false; end if;
  end if;
  legacy := patch - 'tags';
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
    color, reminders, recurrence, recurrence_rule, date_initialized, tags
  ) values (
    p_id, auth.uid(), btrim(p_task->>'title'), coalesce(p_task->>'description', ''),
    (p_task->>'date')::date, (p_task->>'time')::time, (p_task->>'duration_minutes')::integer,
    case when requested_status = 'completed' and rule is null then 'done' else 'planned' end,
    p_task->>'priority', p_task->>'color', offsets, coalesce(rule->>'frequency', 'none'), rule, true,
    array(select jsonb_array_elements_text(coalesce(p_task->'tags', '[]'::jsonb)))
  ) on conflict (id) do nothing returning * into saved;
  if saved.id is null then
    select * into saved from public.tasks where id = p_id and user_id = auth.uid();
    if saved.id is null then raise exception 'Task not found'; end if;
    return saved;
  end if;
  if rule is not null and requested_status = 'completed' then
    if not public.planner_occurs_on(saved.date, rule, p_completion_date) then
      raise exception 'Invalid completion date';
    end if;
    insert into public.task_overrides (user_id, task_id, occurrence_date, status)
      values (auth.uid(), saved.id, p_completion_date, 'completed');
  end if;
  return saved;
end;
$$;
revoke all on function public.create_planner_task(uuid, jsonb, uuid, date) from public;
grant execute on function public.create_planner_task(uuid, jsonb, uuid, date) to authenticated;


notify pgrst, 'reload schema';
commit;
