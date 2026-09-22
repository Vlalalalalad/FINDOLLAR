-- Optional Web Push transport. Existing planner and financial rows stay intact.
-- Run 0005-0007 first. Only the service-role Edge Function can project/claim work.
begin;

create table public.planner_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null check (
    length(endpoint) <= 4096 and endpoint ~ '^https://(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|web\.push\.apple\.com|([a-z0-9-]+\.)+notify\.windows\.com)(/[^[:space:]#]*)?$'
  ),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{86,90}={0,2}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{21,24}={0,2}$'),
  timezone text not null default 'UTC',
  enabled boolean not null default true,
  -- Oldest-first scheduling bounds each cron run without starving later users.
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
create index idx_planner_push_scan on public.planner_push_subscriptions (last_checked_at nulls first, id) where enabled;
create index idx_planner_push_owner on public.planner_push_subscriptions (user_id);

create or replace function public.planner_validate_push_subscription()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
begin
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then raise exception 'Subscription owner cannot change'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Invalid device timezone';
  end if;
  return new;
end;
$$;
create trigger trg_planner_push_validate before insert or update on public.planner_push_subscriptions
  for each row execute procedure public.planner_validate_push_subscription();
create trigger trg_planner_push_updated before update on public.planner_push_subscriptions
  for each row execute procedure public.set_updated_at();
alter table public.planner_push_subscriptions enable row level security;
create policy "planner_push_own" on public.planner_push_subscriptions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.planner_push_subscriptions from anon, authenticated;
grant select, delete on public.planner_push_subscriptions to authenticated;
grant insert (user_id, endpoint, p256dh, auth, timezone, enabled),
  update (user_id, endpoint, p256dh, auth, timezone, enabled) on public.planner_push_subscriptions to authenticated;
grant all on public.planner_push_subscriptions to service_role;

-- Contains delivery metadata only, never copies of task descriptions or titles.
-- A device receives an event once; another subscribed device has its own receipt.
create table public.planner_push_receipts (
  subscription_id uuid not null references public.planner_push_subscriptions(id) on delete cascade,
  event_id text not null,
  task_id uuid not null references public.tasks(id) on delete cascade,
  due_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 8),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  delivered_at timestamptz,
  terminal boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (subscription_id, event_id)
);
create index idx_planner_push_receipts_due on public.planner_push_receipts (due_at);
alter table public.planner_push_receipts enable row level security;
revoke all on public.planner_push_receipts from public, anon, authenticated;
grant all on public.planner_push_receipts to service_role;

-- JavaScript local Date selects the earlier instant during a DST fold, and
-- advances through a gap. PostgreSQL's default fold is later: resolve candidate
-- offsets explicitly so server event IDs equal reminderEvents() in the client.
create or replace function public.planner_push_civil_instant(p_date date, p_time time, p_timezone text)
returns timestamptz language sql stable set search_path = public, pg_catalog as $$
  with wall as (
    select p_date + coalesce(p_time, time '09:00') as local_time
  ), base as (
    select local_time, local_time at time zone p_timezone as instant from wall
  ), offsets as (
    select distinct (probe at time zone p_timezone) - (probe at time zone 'UTC') as utc_offset
    from base cross join lateral unnest(array[instant - interval '2 days', instant, instant + interval '2 days']) probe
  ), candidates as (
    select local_time, (local_time - utc_offset) at time zone 'UTC' as instant from wall cross join offsets
  )
  select coalesce(
    min(instant) filter (where instant at time zone p_timezone = local_time),
    min(instant) filter (where instant at time zone p_timezone > local_time)
  ) from candidates;
$$;
revoke all on function public.planner_push_civil_instant(date, time, text) from public, anon, authenticated;
grant execute on function public.planner_push_civil_instant(date, time, text) to service_role;

-- Expand just the civil days touched by [now - 24h, now + maximum reminder].
-- Explicit moved exceptions participate even if their original rule was changed
-- or disabled. No future task rows or unbounded recurrence history are created.
create or replace function public.planner_due_push_reminders(p_subscription_id uuid, p_now timestamptz default now())
returns table (event_id text, task_id uuid, title text, date date, time text, due_at timestamptz)
language sql stable security definer set search_path = public, pg_catalog as $$
  with device as materialized (
    select s.user_id, s.timezone,
      ((p_now - interval '24 hours') at time zone s.timezone)::date as first_date,
      ((p_now + interval '24 hours') at time zone s.timezone)::date as last_date
    from public.planner_push_subscriptions s where s.id = p_subscription_id and s.enabled
  ), normalized as materialized (
    select t.*, d.timezone, d.first_date, d.last_date,
      coalesce(t.date, case when not t.date_initialized then (t.due_at at time zone d.timezone)::date end) as anchor_date,
      coalesce(t.time, case when not t.date_initialized then date_trunc('minute', t.due_at at time zone d.timezone)::time end) as anchor_time,
      coalesce(t.recurrence_rule, case when not t.date_initialized and t.recurrence <> 'none'
        then jsonb_build_object('frequency', t.recurrence, 'interval', 1, 'until', null) end) as rule
    from public.tasks t join device d on d.user_id = t.user_id
    where cardinality(t.reminders) > 0 or exists (
      select 1 from public.task_overrides o where o.task_id = t.id and not o.deleted
        and jsonb_array_length(coalesce(o.patch->'reminders', '[]'::jsonb)) > 0
    )
  ), identities as (
    select n.id, n.anchor_date as original_date from normalized n
      where n.rule is null and n.anchor_date between n.first_date and n.last_date
    union
    select n.id, n.first_date + day_index from normalized n
      cross join lateral generate_series(0, n.last_date - n.first_date) day_index
      where n.rule is not null and public.planner_occurs_on(n.anchor_date, n.rule, n.first_date + day_index)
    union
    select n.id, o.occurrence_date from normalized n join public.task_overrides o on o.task_id = n.id
      where not o.deleted and (case when o.patch ? 'date' then (o.patch->>'date')::date else o.occurrence_date end)
        between n.first_date and n.last_date
  ), effective as (
    select n.id, i.original_date, n.timezone,
      coalesce(o.patch->>'title', n.title) as title,
      case when o.patch ? 'date' then (o.patch->>'date')::date else i.original_date end as date,
      case when o.patch ? 'time' then (o.patch->>'time')::time else n.anchor_time end as time,
      case when o.patch ? 'reminders' then array(select value::integer from jsonb_array_elements_text(o.patch->'reminders')) else n.reminders end as reminders,
      case when o.id is not null then coalesce(o.status, 'planned')
        when n.rule is not null then case when not n.date_initialized and n.status = 'done' and i.original_date = n.anchor_date then 'completed' else 'planned' end
        when n.status = 'done' then 'completed' else 'planned' end as status
    from identities i join normalized n on n.id = i.id
      left join public.task_overrides o on o.task_id = i.id and o.occurrence_date = i.original_date
    where not coalesce(o.deleted, false)
  ), due as (
    select e.*, minutes_before,
      public.planner_push_civil_instant(e.date, e.time, e.timezone) - make_interval(mins => minutes_before) as due_at
    from effective e cross join lateral unnest(e.reminders) minutes_before
    where e.date is not null and e.status = 'planned'
  )
  select due.id::text || ':' || to_char(due.original_date, 'YYYY-MM-DD') || ':' || due.minutes_before::text || ':' ||
      floor(extract(epoch from due.due_at) * 1000)::bigint::text,
    due.id, due.title, due.date, left(due.time::text, 5), due.due_at
  from due where due.due_at > p_now - interval '24 hours' and due.due_at <= p_now;
$$;
revoke all on function public.planner_due_push_reminders(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.planner_due_push_reminders(uuid, timestamptz) to service_role;

create or replace function public.claim_planner_push_reminders(p_subscription_id uuid, p_limit integer default 8)
returns table (event_id text, task_id uuid, title text, date date, time text, due_at timestamptz, lease_token uuid)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare candidate record; claimed uuid; delivery_token uuid; claim_time timestamptz := clock_timestamp();
begin
  update public.planner_push_subscriptions set last_checked_at = claim_time where id = p_subscription_id and enabled;
  if not found then return; end if;
  for candidate in
    select d.* from public.planner_due_push_reminders(p_subscription_id, claim_time) d
    left join public.planner_push_receipts r on r.subscription_id = p_subscription_id and r.event_id = d.event_id
    where r.event_id is null or (r.delivered_at is null and not r.terminal and r.attempts < 8
      and r.next_attempt_at <= claim_time and (r.lease_until is null or r.lease_until <= claim_time))
    order by d.due_at, d.event_id limit greatest(1, least(coalesce(p_limit, 8), 32))
  loop
    delivery_token := gen_random_uuid();
    claimed := null;
    insert into public.planner_push_receipts as receipt (subscription_id, event_id, task_id, due_at, attempts, lease_token, lease_until, updated_at)
      values (p_subscription_id, candidate.event_id, candidate.task_id, candidate.due_at, 1, delivery_token, claim_time + interval '2 minutes', claim_time)
    on conflict on constraint planner_push_receipts_pkey do update set
      attempts = receipt.attempts + 1, lease_token = delivery_token,
      lease_until = claim_time + interval '2 minutes', updated_at = claim_time
    where receipt.delivered_at is null and not receipt.terminal and receipt.attempts < 8
      and receipt.next_attempt_at <= claim_time and (receipt.lease_until is null or receipt.lease_until <= claim_time)
    returning receipt.lease_token into claimed;
    if claimed is not null then
      event_id := candidate.event_id; task_id := candidate.task_id; title := candidate.title;
      date := candidate.date; time := candidate.time; due_at := candidate.due_at; lease_token := claimed;
      return next;
    end if;
  end loop;
end;
$$;
revoke all on function public.claim_planner_push_reminders(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_planner_push_reminders(uuid, integer) to service_role;

-- A successful push-service response is the delivery acknowledgement. On a lost
-- acknowledgement the lease allows a retry; the worker's stable tag/event ID
-- suppresses duplicates at the device. There is no pre-emptive delivered receipt.
create or replace function public.finish_planner_push_reminder(
  p_subscription_id uuid, p_event_id text, p_lease_token uuid, p_outcome text, p_retry_seconds integer default null
) returns boolean language plpgsql security definer set search_path = public, pg_catalog as $$
declare changed integer;
begin
  if p_outcome not in ('delivered', 'retry', 'expired') then raise exception 'Invalid delivery outcome'; end if;
  update public.planner_push_receipts r set
    delivered_at = case when p_outcome = 'delivered' then clock_timestamp() else null end,
    terminal = p_outcome = 'expired' or (p_outcome = 'retry' and r.attempts >= 8),
    next_attempt_at = clock_timestamp() + make_interval(secs => greatest(30, least(3600,
      coalesce(p_retry_seconds, (60 * power(2, greatest(0, r.attempts - 1)))::integer)))),
    lease_token = null, lease_until = null, updated_at = clock_timestamp()
  where r.subscription_id = p_subscription_id and r.event_id = p_event_id and r.lease_token = p_lease_token and r.delivered_at is null;
  get diagnostics changed = row_count;
  if changed > 0 and p_outcome = 'expired' then
    update public.planner_push_subscriptions set enabled = false where id = p_subscription_id;
  end if;
  return changed > 0;
end;
$$;
revoke all on function public.finish_planner_push_reminder(uuid, text, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.finish_planner_push_reminder(uuid, text, uuid, text, integer) to service_role;

create or replace function public.prune_planner_push_receipts(p_limit integer default 2000)
returns integer language plpgsql security definer set search_path = public, pg_catalog as $$
declare removed integer;
begin
  delete from public.planner_push_receipts where ctid in (
    select ctid from public.planner_push_receipts where due_at < now() - interval '7 days'
    order by due_at limit greatest(1, least(coalesce(p_limit, 2000), 10000))
  );
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.prune_planner_push_receipts(integer) from public, anon, authenticated;
grant execute on function public.prune_planner_push_receipts(integer) to service_role;

notify pgrst, 'reload schema';
commit;
