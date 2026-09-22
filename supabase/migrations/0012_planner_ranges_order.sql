-- Inclusive date ranges remain a single plan identity. Ordering is scoped to
-- the existing priority, never to financial records or new daily task copies.
begin;

alter table public.tasks
  add column end_date date,
  add column manual_order double precision,
  add constraint tasks_planner_end_date check (end_date is null or (date is not null and end_date >= date and extract(year from end_date) between 1 and 9999)),
  add constraint tasks_planner_manual_order check (manual_order is null or manual_order between -1000000000000 and 1000000000000);

alter function public.planner_valid_patch(jsonb) rename to planner_valid_patch_before_ranges;
create function public.planner_valid_patch(patch jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare parsed_end date;
begin
  if patch is null or jsonb_typeof(patch) <> 'object' then return false; end if;
  if patch ? 'end_date' and patch->'end_date' <> 'null'::jsonb then
    if jsonb_typeof(patch->'end_date') <> 'string' or patch->>'end_date' !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
    parsed_end := (patch->>'end_date')::date;
    if extract(year from parsed_end) not between 1 and 9999 then return false; end if;
    if patch ? 'date' and (patch->'date'='null'::jsonb or parsed_end < (patch->>'date')::date) then return false; end if;
  end if;
  if patch ? 'manual_order' and patch->'manual_order' <> 'null'::jsonb and
    (jsonb_typeof(patch->'manual_order') <> 'number' or (patch->>'manual_order')::numeric not between -1000000000000 and 1000000000000) then return false; end if;
  return public.planner_valid_patch_before_ranges(patch - array['end_date','manual_order']);
exception when others then return false;
end;
$$;
alter table public.task_overrides drop constraint task_overrides_patch_check;
alter table public.task_overrides add constraint task_overrides_patch_check check (public.planner_valid_patch(patch));

-- The definitions below retain the existing transactional create, recurrence,
-- conversion and completion paths, extending only date-range/order metadata.
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
    id, user_id, title, description, date, end_date, manual_order, time, duration_minutes, status, priority,
    color, reminders, recurrence, recurrence_rule, date_initialized, tags, auto_complete
  ) values (
    p_id, auth.uid(), btrim(p_task->>'title'), coalesce(p_task->>'description', ''),
    (p_task->>'date')::date, (p_task->>'end_date')::date, (p_task->>'manual_order')::double precision, (p_task->>'time')::time, (p_task->>'duration_minutes')::integer,
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

create or replace function public.save_planner_occurrence(
  p_task_id uuid, p_occurrence_date date, p_patch jsonb default '{}'::jsonb,
  p_status text default null, p_deleted boolean default null, p_user_id uuid default null
) returns public.task_overrides
language plpgsql security invoker set search_path = public as $$
declare saved public.task_overrides; template public.tasks; previous public.task_overrides; legacy_anchor date; prior_date date; prior_end date; final_date date; final_end date;
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
  prior_date := case when previous.patch ? 'date' then (previous.patch->>'date')::date else p_occurrence_date end;
  prior_end := case when previous.patch ? 'end_date' then (previous.patch->>'end_date')::date else prior_date + (template.end_date - template.date) end;
  if p_patch ? 'date' and not (p_patch ? 'end_date') and prior_end is not null then
    p_patch := p_patch || jsonb_build_object('end_date',(p_patch->>'date')::date + (prior_end - prior_date));
  end if;
  p_patch := coalesce(previous.patch, '{}'::jsonb) || p_patch;
  final_date := case when p_patch ? 'date' then (p_patch->>'date')::date else p_occurrence_date end;
  final_end := case when p_patch ? 'end_date' then (p_patch->>'end_date')::date else final_date + (template.end_date - template.date) end;
  if final_end is not null and (final_date is null or final_end < final_date or extract(year from final_end) not between 1 and 9999) then raise exception 'Invalid occurrence date range'; end if;
  if p_patch ? 'date' and p_patch->'date' = 'null'::jsonb then
    p_patch := p_patch || '{"time": null, "reminders": [], "end_date": null}'::jsonb;
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

create or replace function public.auto_complete_planner_occurrence(
  p_task_id uuid, p_occurrence_date date, p_expected_updated_at timestamptz,
  p_timezone text, p_user_id uuid
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare template public.tasks; previous public.task_overrides; saved public.task_overrides;
  effective_date date; effective_end date; effective_time time; duration integer; enabled boolean;
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
  effective_end := case when previous.patch ? 'end_date' then (previous.patch->>'end_date')::date
    when recurring then effective_date + (template.end_date - template.date) else template.end_date end;
  end_at := (coalesce(effective_end,effective_date) + effective_time + make_interval(mins => coalesce(duration, 0))) at time zone p_timezone;
  if end_at > clock_timestamp() then return null; end if;
  if recurring then
    saved := public.save_planner_occurrence(template.id, p_occurrence_date, '{}'::jsonb, 'completed', null, p_user_id);
    return jsonb_build_object('override', to_jsonb(saved));
  end if;
  update public.tasks set status = 'done' where id = template.id and user_id = auth.uid() returning * into template;
  return jsonb_build_object('task', to_jsonb(template));
end;
$$;

create or replace function public.convert_planner_entry(
  p_source_kind text, p_source_id uuid, p_expected_updated_at timestamptz,
  p_target_kind text, p_request_id uuid, p_changes jsonb default '{}'::jsonb,
  p_occurrence_date date default null, p_scope text default 'occurrence',
  p_series_updated_at timestamptz default null, p_target_changes jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  owner uuid := auth.uid(); task_row public.tasks; entry_row public.organization_entries;
  previous public.task_overrides; saved_override public.task_overrides; receipt public.planner_conversion_receipts;
  target_task public.tasks; target_entry public.organization_entries; restored public.task_overrides;
  snapshots jsonb; source jsonb; target jsonb; common jsonb; archived_overrides jsonb := '[]';
  restored_overrides jsonb := '[]'; request jsonb; result jsonb; item jsonb; rule jsonb; destination_changes jsonb;
  target_id uuid := p_source_id; instance boolean := false; current_version timestamptz;
  legacy_recurring boolean := false; legacy_anchor date; legacy_rule jsonb; occurs boolean;
  previous_conversion text := current_setting('planner.converting', true); page_kind text;
begin
  if owner is null then raise exception 'Not authenticated'; end if;
  if p_source_kind not in ('plan','note','goal') or p_target_kind not in ('plan','note','goal')
    or p_source_kind is null or p_target_kind is null or p_source_kind = p_target_kind
    or p_source_id is null or p_request_id is null or p_expected_updated_at is null
    or p_scope is null or p_scope not in ('occurrence','series')
    or p_changes is null or jsonb_typeof(p_changes) <> 'object'
    or p_target_changes is null or jsonb_typeof(p_target_changes) <> 'object' then raise exception 'Invalid conversion'; end if;
  request := jsonb_build_object('sourceKind',p_source_kind,'sourceId',p_source_id,'version',p_expected_updated_at,
    'targetKind',p_target_kind,'changes',p_changes,'targetChanges',p_target_changes,'date',p_occurrence_date,'scope',p_scope,'seriesVersion',p_series_updated_at);
  perform pg_advisory_xact_lock(hashtextextended(owner::text || ':' || p_request_id::text, 0));
  select * into receipt from public.planner_conversion_receipts where id=p_request_id and user_id=owner;
  if receipt.id is not null then
    if receipt.request is distinct from request then raise exception 'Invalid conversion retry'; end if;
    return receipt.result;
  end if;

  if p_source_kind = 'plan' then
    select * into task_row from public.tasks where id=p_source_id and user_id=owner for update;
    if task_row.id is null then raise exception 'Conversion source not found'; end if;
    if p_changes - array['title','description','date','end_date','manual_order','time','duration_minutes','auto_complete','status','priority','color','reminders','recurrence','tags'] <> '{}'::jsonb
      or not public.planner_valid_patch(p_changes - array['recurrence','status'])
      or (p_changes ? 'status' and coalesce(p_changes->>'status','') not in ('planned','completed'))
      or (p_changes ? 'recurrence' and not public.planner_valid_recurrence(nullif(p_changes->'recurrence','null'::jsonb)))
      then raise exception 'Invalid plan conversion changes'; end if;
    select * into previous from public.task_overrides
      where task_id=p_source_id and occurrence_date=p_occurrence_date and user_id=owner for update;
    legacy_recurring := not task_row.date_initialized and task_row.recurrence <> 'none' and task_row.due_at is not null;
    instance := p_scope='occurrence' and (task_row.recurrence_rule is not null or legacy_recurring or previous.id is not null);
    if instance then
      occurs := public.planner_occurs_on(task_row.date,task_row.recurrence_rule,p_occurrence_date);
      if not occurs and legacy_recurring then
        -- The original timestamp has no saved civil timezone. Match the same
        -- bounded local anchor alternatives used by save_planner_occurrence.
        legacy_anchor := (task_row.due_at at time zone 'UTC')::date;
        legacy_rule := jsonb_build_object('frequency',task_row.recurrence,'interval',1,'until',null);
        occurs := public.planner_occurs_on(legacy_anchor - 1,legacy_rule,p_occurrence_date)
          or public.planner_occurs_on(legacy_anchor,legacy_rule,p_occurrence_date)
          or public.planner_occurs_on(legacy_anchor + 1,legacy_rule,p_occurrence_date);
      end if;
      if p_occurrence_date is null or previous.deleted or (previous.id is null and not occurs)
        then raise exception 'Invalid conversion occurrence'; end if;
      if task_row.updated_at is distinct from p_series_updated_at then raise exception 'Conversion source already changed'; end if;
      current_version := coalesce(previous.updated_at,task_row.updated_at);
      target_id := p_request_id;
      source := to_jsonb(task_row) || jsonb_build_object('date',p_occurrence_date) || coalesce(previous.patch,'{}'::jsonb);
      source := source || jsonb_build_object('status',case when previous.status='completed' then 'done' else 'planned' end);
    else
      current_version := task_row.updated_at;
      source := to_jsonb(task_row);
      select coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) into archived_overrides
        from public.task_overrides o where o.task_id=p_source_id and o.user_id=owner;
    end if;
    if current_version is distinct from p_expected_updated_at then raise exception 'Conversion source already changed'; end if;
    if instance and source->>'end_date' is not null then
      source := source || jsonb_build_object('end_date',(source->>'date')::date + (task_row.end_date - task_row.date));
      if previous.patch ? 'end_date' then source := source || jsonb_build_object('end_date',previous.patch->'end_date'); end if;
    end if;
    if p_changes ? 'date' and not (p_changes ? 'end_date') and source->>'end_date' is not null then
      source := source || jsonb_build_object('end_date',(p_changes->>'date')::date + ((source->>'end_date')::date - (source->>'date')::date));
    end if;
    source := source || (p_changes - array['status','recurrence']);
    if p_changes ? 'status' then source := source || jsonb_build_object('status',case when p_changes->>'status'='completed' then 'done' else 'planned' end); end if;
    if p_changes ? 'recurrence' then
      rule := nullif(p_changes->'recurrence','null'::jsonb);
      source := source || jsonb_build_object('recurrence_rule',rule,'recurrence',coalesce(rule->>'frequency','none'));
    end if;
    if instance then source := source || '{"recurrence":"none","recurrence_rule":null}'::jsonb; end if;
    source := source || jsonb_build_object('id',target_id,'user_id',owner);
  else
    if p_occurrence_date is not null then raise exception 'Invalid conversion occurrence'; end if;
    select * into entry_row from public.organization_entries where id=p_source_id and user_id=owner and kind=p_source_kind for update;
    if entry_row.id is null then raise exception 'Conversion source not found'; end if;
    if entry_row.updated_at is distinct from p_expected_updated_at then raise exception 'Conversion source already changed'; end if;
    if p_changes - array['title','description','date','tags','page_id','kind','data'] <> '{}'::jsonb
      or (p_changes ? 'kind' and p_changes->>'kind' is distinct from p_source_kind)
      then raise exception 'Invalid organization conversion changes'; end if;
    source := to_jsonb(entry_row) || p_changes;
    if not public.organization_valid_data(p_source_kind,source->'data') then raise exception 'Invalid organization conversion data'; end if;
  end if;
  if jsonb_typeof(source->'title') <> 'string' or length(btrim(source->>'title')) not between 1 and 200
    or length(coalesce(source->>'description','')) > 20000
    or (source->'description' <> 'null'::jsonb and jsonb_typeof(source->'description') <> 'string')
    or jsonb_typeof(source->'tags') <> 'array'
    or not public.organization_valid_tags(array(select jsonb_array_elements_text(source->'tags')))
    then raise exception 'Invalid conversion text or tags'; end if;

  select a.snapshots into snapshots from public.planner_entry_archives a where a.id=target_id and a.user_id=owner for update;
  snapshots := coalesce(snapshots,'{}'::jsonb);
  snapshots := snapshots || jsonb_build_object(p_source_kind,jsonb_build_object('row',source,'overrides',archived_overrides));
  if p_source_kind <> 'goal' then snapshots := snapshots || jsonb_build_object('calendarDate',source->'date'); end if;
  if instance then snapshots := snapshots || jsonb_build_object('origin',jsonb_build_object('taskId',p_source_id,'occurrenceDate',p_occurrence_date,
    'template',to_jsonb(task_row),'override',to_jsonb(previous))); end if;
  common := jsonb_build_object('id',target_id,'user_id',owner,'title',btrim(source->>'title'),
    'description',coalesce(source->>'description',''),'tags',source->'tags',
    'date',coalesce(snapshots->'calendarDate','null'::jsonb),'created_at',source->'created_at','updated_at',clock_timestamp());

  -- Parameters edited after selecting the destination type belong to this same
  -- transaction. They must never be a second, potentially failing client write.
  destination_changes := p_target_changes;
  if p_target_kind='plan' then
    if destination_changes - array['title','description','date','end_date','manual_order','time','duration_minutes','auto_complete','status','priority','color','reminders','recurrence','tags'] <> '{}'::jsonb
      or not public.planner_valid_patch(destination_changes - array['recurrence','status'])
      or (destination_changes ? 'status' and coalesce(destination_changes->>'status','') not in ('planned','completed'))
      or (destination_changes ? 'recurrence' and not public.planner_valid_recurrence(nullif(destination_changes->'recurrence','null'::jsonb)))
      then raise exception 'Invalid plan conversion destination'; end if;
    if destination_changes ? 'status' then destination_changes := destination_changes || jsonb_build_object('status',case when destination_changes->>'status'='completed' then 'done' else 'planned' end); end if;
    if destination_changes ? 'recurrence' then
      rule := nullif(destination_changes->'recurrence','null'::jsonb);
      destination_changes := destination_changes || jsonb_build_object('recurrence_rule',rule,'recurrence',coalesce(rule->>'frequency','none'));
    end if;
  else
    if destination_changes - array['title','description','date','tags','page_id','kind','data'] <> '{}'::jsonb
      or (destination_changes ? 'kind' and destination_changes->>'kind' is distinct from p_target_kind)
      or (destination_changes ? 'data' and not public.organization_valid_data(p_target_kind,destination_changes->'data'))
      then raise exception 'Invalid organization conversion destination'; end if;
    if not public.planner_valid_patch(destination_changes - array['page_id','kind','data']) then raise exception 'Invalid conversion destination text'; end if;
  end if;

  -- Conversion is scoped to the active owner's rows. RLS is also enabled on all
  -- tables; SECURITY DEFINER only permits writing the otherwise private archive.
  perform set_config('planner.converting','true',true);
  if instance then
    insert into public.task_overrides (user_id,task_id,occurrence_date,patch,status,deleted)
      values (owner,p_source_id,p_occurrence_date,coalesce(previous.patch,'{}'),previous.status,true)
      on conflict (task_id,occurrence_date) do update set deleted=true returning * into saved_override;
  elsif p_source_kind='plan' then
    delete from public.tasks where id=p_source_id and user_id=owner;
  else
    delete from public.organization_entries where id=p_source_id and user_id=owner and kind=p_source_kind;
  end if;
  -- UUID collisions never overwrite another active record, including same-owner
  -- records in the other table. A failed insert rolls back the source removal.
  if exists(select 1 from public.tasks where id=target_id) or exists(select 1 from public.organization_entries where id=target_id)
    then raise exception 'Invalid conversion target identity'; end if;

  if p_target_kind='plan' then
    target := '{"priority":"none","status":"planned","date":null,"time":null,"duration_minutes":null,"auto_complete":false,"color":"#0E8F6E","reminders":[],"tags":[],"recurrence":"none","recurrence_rule":null,"date_initialized":true}'::jsonb
      || coalesce(snapshots->'plan'->'row','{}'::jsonb) || common;
    -- The note's latest calendar date replaces the archived plan's start. Move
    -- its end by the same amount before applying any explicit destination edit.
    if snapshots->'plan'->'row'->>'end_date' is not null then
      target := target || jsonb_build_object('end_date',(target->>'date')::date
        + ((snapshots->'plan'->'row'->>'end_date')::date - (snapshots->'plan'->'row'->>'date')::date));
    end if;
    if source->'data'->'goal' ? 'completed' then
      target := target || jsonb_build_object('status',case when (source->'data'->'goal'->>'completed')::boolean then 'done' else 'planned' end);
    end if;
    if destination_changes ? 'date' and not (destination_changes ? 'end_date') and target->>'end_date' is not null then
      target := target || jsonb_build_object('end_date',(destination_changes->>'date')::date + ((target->>'end_date')::date - (target->>'date')::date));
    end if;
    target := target || destination_changes;
    -- Inactive plan settings remain in its archive when a dated note is cleared.
    if target->'date'='null'::jsonb then target := target || '{"time":null,"end_date":null,"reminders":[],"auto_complete":false,"recurrence":"none","recurrence_rule":null}'::jsonb; end if;
    if target->>'linked_transaction_id' is not null and not exists(select 1 from public.transactions where id=(target->>'linked_transaction_id')::uuid and user_id=owner)
      then target := target || '{"linked_transaction_id":null}'::jsonb; end if;
    target_task := jsonb_populate_record(null::public.tasks,target);
    insert into public.tasks select (target_task).* returning * into target_task;
    for item in select value from jsonb_array_elements(coalesce(snapshots->'plan'->'overrides','[]')) loop
      restored := jsonb_populate_record(null::public.task_overrides,item || jsonb_build_object('task_id',target_id,'user_id',owner,'updated_at',clock_timestamp()));
      insert into public.task_overrides select (restored).* returning * into restored;
      restored_overrides := restored_overrides || jsonb_build_array(to_jsonb(restored));
    end loop;
    result := jsonb_build_object('task',to_jsonb(target_task),'overrides',restored_overrides);
  else
    target := jsonb_build_object('page_id',null,'data',case when p_target_kind='goal' then
      '{"goal":{"period":"none","year":null,"startDate":null,"endDate":null,"items":[]}}'::jsonb else '{}'::jsonb end)
      || coalesce(snapshots->p_target_kind->'row','{}'::jsonb) || common || jsonb_build_object('kind',p_target_kind);
    if p_target_kind='goal' then
      target := target || '{"date":null}'::jsonb;
      if p_source_kind='plan' then target := jsonb_set(target,'{data,goal,completed}',to_jsonb(source->>'status'='done')); end if;
    end if;
    target := target || destination_changes;
    -- A previous page is restored only if it still exists and accepts this type.
    select kind into page_kind from public.organization_pages where id=(target->>'page_id')::uuid and user_id=owner;
    if page_kind is null or (page_kind='notes' and p_target_kind<>'note') or (page_kind='goals' and p_target_kind<>'goal')
      then target := target || '{"page_id":null}'::jsonb; end if;
    target_entry := jsonb_populate_record(null::public.organization_entries,target);
    insert into public.organization_entries select (target_entry).* returning * into target_entry;
    result := jsonb_build_object('entry',to_jsonb(target_entry));
  end if;
  insert into public.planner_entry_archives(id,user_id,snapshots) values(target_id,owner,snapshots)
    on conflict(id,user_id) do update set snapshots=excluded.snapshots;
  result := result || jsonb_build_object('sourceKind',p_source_kind,'sourceId',p_source_id,'sourceRemoved',not instance,'targetKind',p_target_kind,'targetId',target_id);
  if instance then result := result || jsonb_build_object('override',to_jsonb(saved_override)); end if;
  insert into public.planner_conversion_receipts(id,user_id,target_id,request,result) values(p_request_id,owner,target_id,request,result);
  perform set_config('planner.converting',coalesce(previous_conversion,''),true);
  return result;
end;
$$;

create function public.reorder_planner_occurrences(p_items jsonb, p_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare item jsonb; template public.tasks; previous public.task_overrides; saved public.task_overrides;
  source_task_id uuid; source_occurrence_date date; expected timestamptz; priority text; cohort text;
  templates jsonb := '[]'; exceptions jsonb := '[]'; position integer := 0; legacy_anchor date; valid_occurrence boolean;
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() then raise exception 'Not authenticated'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 2000 then raise exception 'Invalid reorder items'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) i where jsonb_typeof(i) <> 'object'
    or not (i ?& array['task_id','occurrence_date','expected_updated_at'])
    or i - array['task_id','occurrence_date','expected_updated_at'] <> '{}'::jsonb
    or jsonb_typeof(i->'task_id') <> 'string' or jsonb_typeof(i->'expected_updated_at') <> 'string'
    or (i->'occurrence_date' <> 'null'::jsonb and jsonb_typeof(i->'occurrence_date') <> 'string')) then raise exception 'Invalid reorder item'; end if;
  if jsonb_array_length(p_items) <> (select count(distinct (i->>'task_id',i->>'occurrence_date')) from jsonb_array_elements(p_items) i) then raise exception 'Invalid duplicate reorder item'; end if;
  -- A stable lock order serializes overlapping reorder/save/conversion requests.
  perform 1 from public.tasks t where t.user_id=p_user_id and t.id in
    (select (i->>'task_id')::uuid from jsonb_array_elements(p_items) i) order by t.id for update;
  for item in select value from jsonb_array_elements(p_items) loop
    source_task_id := (item->>'task_id')::uuid; source_occurrence_date := (item->>'occurrence_date')::date; expected := (item->>'expected_updated_at')::timestamptz;
    select * into template from public.tasks t where t.id=source_task_id and t.user_id=p_user_id;
    if template.id is null then raise exception 'Reorder source not found'; end if;
    select * into previous from public.task_overrides o where o.task_id=template.id and o.occurrence_date=source_occurrence_date and o.user_id=p_user_id for update;
    if source_occurrence_date is null then
      if template.recurrence_rule is not null or (not template.date_initialized and template.recurrence <> 'none') then raise exception 'Invalid reorder recurrence'; end if;
      if template.updated_at is distinct from expected then raise exception 'Reorder source already changed'; end if;
    else
      if previous.deleted then raise exception 'Reorder source already changed'; end if;
      valid_occurrence := public.planner_occurs_on(template.date,template.recurrence_rule,source_occurrence_date);
      if previous.id is null and not valid_occurrence and not template.date_initialized and template.recurrence <> 'none' and template.due_at is not null then
        legacy_anchor := (template.due_at at time zone 'UTC')::date;
        valid_occurrence := public.planner_occurs_on(legacy_anchor-1,jsonb_build_object('frequency',template.recurrence,'interval',1,'until',null),source_occurrence_date)
          or public.planner_occurs_on(legacy_anchor,jsonb_build_object('frequency',template.recurrence,'interval',1,'until',null),source_occurrence_date)
          or public.planner_occurs_on(legacy_anchor+1,jsonb_build_object('frequency',template.recurrence,'interval',1,'until',null),source_occurrence_date);
      end if;
      if previous.id is null and not valid_occurrence then raise exception 'Invalid reorder occurrence'; end if;
      if coalesce(previous.updated_at,template.updated_at) is distinct from expected then raise exception 'Reorder source already changed'; end if;
    end if;
    priority := coalesce(previous.patch->>'priority',template.priority);
    if cohort is null then cohort := priority; elsif cohort <> priority then raise exception 'Reorder requires one priority'; end if;
  end loop;
  -- Validate the entire cohort before writing; any failure rolls it all back.
  for item in select value from jsonb_array_elements(p_items) loop
    source_task_id := (item->>'task_id')::uuid; source_occurrence_date := (item->>'occurrence_date')::date;
    if source_occurrence_date is null then
      update public.tasks t set manual_order=position where t.id=source_task_id and t.user_id=p_user_id returning t.* into template;
      templates := templates || jsonb_build_array(to_jsonb(template));
    else
      saved := public.save_planner_occurrence(source_task_id,source_occurrence_date,jsonb_build_object('manual_order',position),null,null,p_user_id);
      exceptions := exceptions || jsonb_build_array(to_jsonb(saved));
    end if;
    position := position + 1;
  end loop;
  return jsonb_build_object('tasks',templates,'overrides',exceptions);
end;
$$;
revoke all on function public.reorder_planner_occurrences(jsonb,uuid) from public;
grant execute on function public.reorder_planner_occurrences(jsonb,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
