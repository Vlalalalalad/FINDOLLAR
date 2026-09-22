-- Planner: reuse the existing task table. No financial table or row is changed.
-- Existing due_at / recurrence / status values are preserved. The client adapts
-- legacy due_at in the user's timezone until date_initialized becomes true.
begin;

alter table public.tasks
  add column if not exists date date,
  add column if not exists time time without time zone,
  add column if not exists duration_minutes integer,
  add column if not exists color text not null default '#0E8F6E',
  add column if not exists reminders integer[] not null default '{}',
  add column if not exists recurrence_rule jsonb,
  add column if not exists date_initialized boolean not null default false;

create or replace function public.planner_valid_recurrence(rule jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare item jsonb; until_date date;
begin
  if rule is null then return true; end if;
  if jsonb_typeof(rule) <> 'object'
    or not (rule ?& array['frequency', 'interval', 'until'])
    or rule - array['frequency', 'interval', 'until', 'weekdays'] <> '{}'::jsonb
    or coalesce(rule->>'frequency', '') not in ('daily', 'weekly', 'monthly')
    or jsonb_typeof(rule->'interval') <> 'number'
    or (rule->>'interval')::numeric <> trunc((rule->>'interval')::numeric)
    or (rule->>'interval')::integer not between 1 and 3650
  then return false; end if;
  if rule->'until' <> 'null'::jsonb then
    if jsonb_typeof(rule->'until') <> 'string' or (rule->>'until') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
    until_date := (rule->>'until')::date;
  end if;
  if rule ? 'weekdays' then
    if rule->>'frequency' <> 'weekly' or jsonb_typeof(rule->'weekdays') <> 'array'
      or jsonb_array_length(rule->'weekdays') not between 1 and 7 then return false; end if;
    for item in select value from jsonb_array_elements(rule->'weekdays') loop
      if jsonb_typeof(item) <> 'number' or item::text !~ '^[0-6]$' then return false; end if;
    end loop;
    if (select count(*) from jsonb_array_elements(rule->'weekdays')) <>
      (select count(distinct value) from jsonb_array_elements(rule->'weekdays')) then return false; end if;
  end if;
  return true;
exception when others then return false;
end;
$$;

create or replace function public.planner_valid_reminders(values_to_check integer[])
returns boolean language sql immutable set search_path = public as $$
  select values_to_check is not null
    and values_to_check <@ array[0, 5, 10, 15, 30, 60, 1440]
    and array_position(values_to_check, null) is null
    and cardinality(values_to_check) = (select count(distinct item) from unnest(values_to_check) item);
$$;

alter table public.tasks
  add constraint tasks_planner_owner_unique unique (id, user_id),
  add constraint tasks_planner_color check (color ~ '^#[0-9a-fA-F]{6}$'),
  add constraint tasks_planner_duration check (duration_minutes is null or duration_minutes between 1 and 10080),
  add constraint tasks_planner_reminders check (public.planner_valid_reminders(reminders)),
  add constraint tasks_planner_recurrence check (public.planner_valid_recurrence(recurrence_rule)),
  add constraint tasks_planner_recurrence_date check (recurrence_rule is null or date is not null),
  add constraint tasks_planner_until check (recurrence_rule is null or recurrence_rule->>'until' is null or (recurrence_rule->>'until')::date >= date),
  add constraint tasks_planner_date_time check (not date_initialized or date is not null or (time is null and cardinality(reminders) = 0)),
  add constraint tasks_planner_civil_date check (date is null or extract(year from date) between 1 and 9999),
  add constraint tasks_planner_clock check (time is null or (time < time '24:00' and extract(second from time) = 0)),
  add constraint tasks_planner_title check (not date_initialized or length(btrim(title)) between 1 and 200),
  add constraint tasks_planner_description check (not date_initialized or description is null or length(description) <= 10000);

create index idx_tasks_planner_date on public.tasks (user_id, date);
create index idx_tasks_planner_status on public.tasks (user_id, status);

create or replace function public.planner_valid_patch(patch jsonb)
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

-- Match the client's bounded civil-date projection without materializing a
-- series: weeks start on Monday; month-end anchors clamp to the target month.
create or replace function public.planner_occurs_on(anchor_date date, rule jsonb, occurrence date)
returns boolean language plpgsql immutable set search_path = public as $$
declare spacing integer; month_distance integer; month_start date; target_date date; weekday integer;
begin
  if anchor_date is null or occurrence is null or rule is null or not public.planner_valid_recurrence(rule) then return false; end if;
  if occurrence < anchor_date or (rule->>'until' is not null and occurrence > (rule->>'until')::date) then return false; end if;
  spacing := (rule->>'interval')::integer;
  if rule->>'frequency' = 'daily' then return (occurrence - anchor_date) % spacing = 0; end if;
  if rule->>'frequency' = 'weekly' then
    weekday := extract(dow from occurrence)::integer;
    if rule ? 'weekdays' then
      if not (rule->'weekdays' @> jsonb_build_array(weekday)) then return false; end if;
    elsif weekday <> extract(dow from anchor_date)::integer then return false;
    end if;
    return ((date_trunc('week', occurrence)::date - date_trunc('week', anchor_date)::date) / 7) % spacing = 0;
  end if;
  month_distance := (extract(year from occurrence)::integer - extract(year from anchor_date)::integer) * 12
    + extract(month from occurrence)::integer - extract(month from anchor_date)::integer;
  if month_distance % spacing <> 0 then return false; end if;
  month_start := date_trunc('month', occurrence)::date;
  target_date := month_start + least(extract(day from anchor_date)::integer,
    extract(day from month_start + interval '1 month - 1 day')::integer) - 1;
  return occurrence = target_date;
end;
$$;

create table public.task_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null,
  occurrence_date date not null,
  patch jsonb not null default '{}'::jsonb check (public.planner_valid_patch(patch)),
  status text check (status in ('planned', 'completed')),
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_overrides_task_owner foreign key (task_id, user_id)
    references public.tasks (id, user_id) on delete cascade,
  constraint task_overrides_occurrence_unique unique (task_id, occurrence_date)
);

create index idx_task_overrides_user_date on public.task_overrides (user_id, occurrence_date);
create trigger trg_task_overrides_updated before update on public.task_overrides
  for each row execute procedure public.set_updated_at();
alter table public.task_overrides enable row level security;
create policy "task_overrides_all_own" on public.task_overrides for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.task_overrides to authenticated;

-- Merge a sparse patch on the server so another tab toggling status cannot
-- replace a concurrent reschedule. The unique key prevents duplicate instances.
create or replace function public.save_planner_occurrence(
  p_task_id uuid, p_occurrence_date date, p_patch jsonb default '{}'::jsonb,
  p_status text default null, p_deleted boolean default null, p_user_id uuid default null
) returns public.task_overrides
language plpgsql security invoker set search_path = public as $$
declare saved public.task_overrides; template public.tasks; previous public.task_overrides; legacy_anchor date;
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() then raise exception 'Not authenticated'; end if;
  select * into template from public.tasks where id = p_task_id and user_id = auth.uid() for update;
  if template.id is null then raise exception 'Task not found'; end if;
  if not public.planner_valid_patch(p_patch) then raise exception 'Invalid occurrence patch'; end if;
  select * into previous from public.task_overrides where task_id = p_task_id and occurrence_date = p_occurrence_date;
  if previous.id is null and not public.planner_occurs_on(template.date, template.recurrence_rule, p_occurrence_date) then
    -- A legacy timestamp has no stored civil timezone. Until its first explicit
    -- edit, allow the three possible local anchor dates for its original rule.
    legacy_anchor := (template.due_at at time zone 'UTC')::date;
    if template.date_initialized or template.recurrence = 'none' or legacy_anchor is null or not (
      public.planner_occurs_on(legacy_anchor - 1, jsonb_build_object('frequency', template.recurrence, 'interval', 1, 'until', null), p_occurrence_date) or
      public.planner_occurs_on(legacy_anchor, jsonb_build_object('frequency', template.recurrence, 'interval', 1, 'until', null), p_occurrence_date) or
      public.planner_occurs_on(legacy_anchor + 1, jsonb_build_object('frequency', template.recurrence, 'interval', 1, 'until', null), p_occurrence_date)
    ) then raise exception 'Date is not an occurrence of this task'; end if;
  end if;
  -- Existing exceptions stay editable even after a rule change or disabling
  -- recurrence. Only real, explicitly persisted exceptions receive this path.
  p_patch := coalesce(previous.patch, '{}'::jsonb) || p_patch;
  if p_patch ? 'date' and p_patch->'date' = 'null'::jsonb then
    p_patch := p_patch || '{"time": null, "reminders": []}'::jsonb;
  end if;
  insert into public.task_overrides (user_id, task_id, occurrence_date, patch, status, deleted)
    values (auth.uid(), p_task_id, p_occurrence_date, p_patch, p_status, coalesce(p_deleted, false))
  on conflict (task_id, occurrence_date) do update set
    patch = public.task_overrides.patch || excluded.patch,
    status = coalesce(p_status, public.task_overrides.status),
    deleted = coalesce(p_deleted, public.task_overrides.deleted)
  returning * into saved;
  return saved;
end;
$$;
revoke all on function public.save_planner_occurrence(uuid, date, jsonb, text, boolean, uuid) from public;
grant execute on function public.save_planner_occurrence(uuid, date, jsonb, text, boolean, uuid) to authenticated;

-- Stable client UUID makes create retries idempotent. Completing the first
-- occurrence and creating its planned series are one database transaction.
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
    color, reminders, recurrence, recurrence_rule, date_initialized
  ) values (
    p_id, auth.uid(), btrim(p_task->>'title'), coalesce(p_task->>'description', ''),
    (p_task->>'date')::date, (p_task->>'time')::time, (p_task->>'duration_minutes')::integer,
    case when requested_status = 'completed' and rule is null then 'done' else 'planned' end,
    p_task->>'priority', p_task->>'color', offsets, coalesce(rule->>'frequency', 'none'), rule, true
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
