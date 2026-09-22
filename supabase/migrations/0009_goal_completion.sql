-- Optional whole-goal completion, independent of checklist progress.
-- Existing payloads without completed remain valid and mean an active goal.
-- This only widens the validator; no existing records are rewritten.
begin;

create or replace function public.organization_valid_data(record_kind text, payload jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare goal jsonb; item jsonb; first_day date; last_day date; target_year numeric;
begin
  if payload is null or jsonb_typeof(payload) is distinct from 'object' then return false; end if;
  if record_kind = 'note' then return payload = '{}'::jsonb; end if;
  if record_kind <> 'goal' or payload - 'goal' <> '{}'::jsonb or not (payload ? 'goal') then return false; end if;
  goal := payload->'goal';
  if jsonb_typeof(goal) is distinct from 'object'
    or not (goal ?& array['period', 'year', 'startDate', 'endDate', 'items'])
    or goal - array['period', 'year', 'startDate', 'endDate', 'items', 'completed'] <> '{}'::jsonb
    or (goal ? 'completed' and jsonb_typeof(goal->'completed') is distinct from 'boolean')
    or coalesce(goal->>'period', '') not in ('none', 'year', 'custom')
    or jsonb_typeof(goal->'items') is distinct from 'array'
    or jsonb_array_length(goal->'items') > 200 then return false; end if;
  if goal->>'period' = 'year' then
    if jsonb_typeof(goal->'year') is distinct from 'number' or goal->'startDate' <> 'null'::jsonb or goal->'endDate' <> 'null'::jsonb then return false; end if;
    target_year := (goal->>'year')::numeric;
    if target_year <> trunc(target_year) or target_year not between 1 and 9999 then return false; end if;
  elsif goal->>'period' = 'custom' then
    if goal->'year' <> 'null'::jsonb or jsonb_typeof(goal->'startDate') is distinct from 'string' or jsonb_typeof(goal->'endDate') is distinct from 'string'
      or (goal->>'startDate') !~ '^\d{4}-\d{2}-\d{2}$' or (goal->>'endDate') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
    first_day := (goal->>'startDate')::date; last_day := (goal->>'endDate')::date;
    if last_day < first_day or extract(year from first_day) not between 1 and 9999 or extract(year from last_day) not between 1 and 9999 then return false; end if;
  elsif goal->'year' <> 'null'::jsonb or goal->'startDate' <> 'null'::jsonb or goal->'endDate' <> 'null'::jsonb then return false;
  end if;
  for item in select value from jsonb_array_elements(goal->'items') loop
    if jsonb_typeof(item) is distinct from 'object' or not (item ?& array['id', 'title', 'completed'])
      or item - array['id', 'title', 'completed'] <> '{}'::jsonb
      or jsonb_typeof(item->'id') is distinct from 'string' or length(item->>'id') not between 1 and 100
      or jsonb_typeof(item->'title') is distinct from 'string' or length(btrim(item->>'title')) not between 1 and 300
      or jsonb_typeof(item->'completed') is distinct from 'boolean' then return false; end if;
  end loop;
  if jsonb_array_length(goal->'items') <> (select count(distinct value->>'id') from jsonb_array_elements(goal->'items')) then return false; end if;
  return true;
exception when others then return false;
end;
$$;

commit;
