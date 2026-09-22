-- Atomic type conversion. Existing rows and financial tables are not rewritten.
-- One stable identity owns bounded snapshots of its inactive types. A converted
-- recurrence is detached as one record; its template and other days stay intact.
begin;

-- A note can contain 20k characters. Conversion must never truncate its text.
alter table public.tasks drop constraint tasks_planner_description;
alter table public.tasks add constraint tasks_planner_description
  check (not date_initialized or description is null or length(description) <= 20000);
alter function public.planner_valid_patch(jsonb) rename to planner_valid_patch_before_conversion;
create function public.planner_valid_patch(patch jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
begin
  if patch ? 'description' and patch->'description' <> 'null'::jsonb
    and (jsonb_typeof(patch->'description') <> 'string' or length(patch->>'description') > 20000) then return false; end if;
  return public.planner_valid_patch_before_conversion(patch - 'description');
exception when others then return false;
end;
$$;
alter table public.task_overrides drop constraint task_overrides_patch_check;
alter table public.task_overrides add constraint task_overrides_patch_check check (public.planner_valid_patch(patch));

create table public.planner_entry_archives (
  id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshots jsonb not null check (jsonb_typeof(snapshots) = 'object'),
  primary key (id, user_id)
);
create table public.planner_conversion_receipts (
  id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null,
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (id, user_id)
);
alter table public.planner_entry_archives enable row level security;
alter table public.planner_conversion_receipts enable row level security;
create policy planner_archives_read_own on public.planner_entry_archives for select to authenticated
  using ((select auth.uid()) = user_id);
create policy planner_receipts_read_own on public.planner_conversion_receipts for select to authenticated
  using ((select auth.uid()) = user_id);
grant select on public.planner_entry_archives, public.planner_conversion_receipts to authenticated;
-- Snapshots are only authored by the conversion transaction, not by client JSON.
revoke insert, update, delete on public.planner_entry_archives, public.planner_conversion_receipts from authenticated;

create function public.convert_planner_entry(
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
    if p_changes - array['title','description','date','time','duration_minutes','auto_complete','status','priority','color','reminders','recurrence','tags'] <> '{}'::jsonb
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
    if destination_changes - array['title','description','date','time','duration_minutes','auto_complete','status','priority','color','reminders','recurrence','tags'] <> '{}'::jsonb
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
    if source->'data'->'goal' ? 'completed' then
      target := target || jsonb_build_object('status',case when (source->'data'->'goal'->>'completed')::boolean then 'done' else 'planned' end);
    end if;
    target := target || destination_changes;
    -- Inactive plan settings remain in its archive when a dated note is cleared.
    if target->'date'='null'::jsonb then target := target || '{"time":null,"reminders":[],"auto_complete":false,"recurrence":"none","recurrence_rule":null}'::jsonb; end if;
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
revoke all on function public.convert_planner_entry(text,uuid,timestamptz,text,uuid,jsonb,date,text,timestamptz,jsonb) from public;
grant execute on function public.convert_planner_entry(text,uuid,timestamptz,text,uuid,jsonb,date,text,timestamptz,jsonb) to authenticated;

-- Ordinary deletion erases inactive payloads too. A type move retains them only
-- inside its transaction; direct clients cannot edit the archived snapshots.
create function public.planner_delete_entry_archive() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if current_setting('planner.converting',true) is distinct from 'true' then
    delete from public.planner_entry_archives where id=old.id and user_id=old.user_id;
    delete from public.planner_conversion_receipts where target_id=old.id and user_id=old.user_id;
  end if;
  return old;
end;
$$;
revoke all on function public.planner_delete_entry_archive() from public;
create trigger trg_tasks_conversion_cleanup after delete on public.tasks for each row execute function public.planner_delete_entry_archive();
create trigger trg_organization_conversion_cleanup after delete on public.organization_entries for each row execute function public.planner_delete_entry_archive();
notify pgrst, 'reload schema';
commit;
