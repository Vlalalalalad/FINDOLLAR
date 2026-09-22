-- Additive organization records. No existing tasks or financial rows are changed.
begin;

create or replace function public.organization_valid_tags(items text[])
returns boolean language sql immutable set search_path = public as $$
  select items is not null and cardinality(items) <= 20
    and array_position(items, null) is null
    and not exists (select 1 from unnest(items) item where length(btrim(item)) not between 1 and 40)
    and cardinality(items) = (select count(distinct item) from unnest(items) item);
$$;

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
    or goal - array['period', 'year', 'startDate', 'endDate', 'items'] <> '{}'::jsonb
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

create table public.organization_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 100),
  kind text not null default 'mixed' check (kind in ('notes', 'goals', 'mixed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_pages_owner_unique unique (id, user_id)
);

create table public.organization_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  page_id uuid,
  kind text not null check (kind in ('note', 'goal')),
  title text not null check (length(btrim(title)) between 1 and 200),
  description text not null default '' check (length(description) <= 20000),
  date date check (date is null or extract(year from date) between 1 and 9999),
  tags text[] not null default '{}' check (public.organization_valid_tags(tags)),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_entries_page_owner foreign key (page_id, user_id) references public.organization_pages(id, user_id) on delete restrict,
  constraint organization_entries_typed_data check (public.organization_valid_data(kind, data)),
  constraint organization_goals_own_period check (kind <> 'goal' or date is null)
);

create index idx_organization_pages_owner on public.organization_pages(user_id, created_at);
create index idx_organization_entries_owner_kind on public.organization_entries(user_id, kind, updated_at desc);
create index idx_organization_entries_page on public.organization_entries(user_id, page_id);
create index idx_organization_entries_date on public.organization_entries(user_id, date) where date is not null;

create trigger trg_organization_pages_updated before update on public.organization_pages
  for each row execute procedure public.set_updated_at();
create trigger trg_organization_entries_updated before update on public.organization_entries
  for each row execute procedure public.set_updated_at();

create or replace function public.organization_validate_entry()
returns trigger language plpgsql set search_path = public as $$
declare page_kind text;
begin
  if tg_op = 'UPDATE' and (new.kind <> old.kind or new.user_id <> old.user_id) then raise exception 'Record kind and owner cannot change'; end if;
  if new.page_id is not null then
    select kind into page_kind from public.organization_pages where id = new.page_id and user_id = new.user_id for share;
    if page_kind is null then raise exception 'Organization page not found'; end if;
    if (page_kind = 'notes' and new.kind <> 'note') or (page_kind = 'goals' and new.kind <> 'goal') then raise exception 'Record kind does not match page'; end if;
  end if;
  return new;
end;
$$;
create trigger trg_organization_entries_validate before insert or update on public.organization_entries
  for each row execute procedure public.organization_validate_entry();

create or replace function public.organization_validate_page()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.user_id <> old.user_id then raise exception 'Page owner cannot change'; end if;
  if new.kind <> old.kind and new.kind <> 'mixed' and exists (
    select 1 from public.organization_entries where page_id = new.id and kind <> case new.kind when 'notes' then 'note' else 'goal' end
  ) then raise exception 'Page contains records of another kind'; end if;
  return new;
end;
$$;
create trigger trg_organization_pages_validate before update on public.organization_pages
  for each row execute procedure public.organization_validate_page();

alter table public.organization_pages enable row level security;
alter table public.organization_entries enable row level security;
create policy "organization_pages_all_own" on public.organization_pages for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "organization_entries_all_own" on public.organization_entries for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.organization_pages, public.organization_entries to authenticated;

-- Deleting a page preserves every record in the built-in Notes/Goals sections.
-- Return moved records so the client can keep acknowledged state on failed reads.
create or replace function public.delete_organization_page(p_id uuid, p_expected_updated_at timestamptz)
returns setof public.organization_entries language plpgsql security invoker set search_path = public as $$
declare current_page public.organization_pages;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into current_page from public.organization_pages where id = p_id and user_id = auth.uid() for update;
  if current_page.id is null then raise exception 'Organization page not found'; end if;
  if current_page.updated_at is distinct from p_expected_updated_at then raise exception 'Organization page already changed'; end if;
  return query update public.organization_entries set page_id = null where page_id = p_id and user_id = auth.uid() returning *;
  delete from public.organization_pages where id = p_id and user_id = auth.uid();
end;
$$;
revoke all on function public.delete_organization_page(uuid, timestamptz) from public;
grant execute on function public.delete_organization_page(uuid, timestamptz) to authenticated;

commit;
