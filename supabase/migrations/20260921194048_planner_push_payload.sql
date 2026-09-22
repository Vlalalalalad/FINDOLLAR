-- Extend the live Web Push path without changing the old claim RPC used by
-- already-deployed Edge Functions. One subscription row remains one account on
-- one browser installation; the same endpoint can belong to several accounts.
begin;

-- A subscription endpoint is supplied by an authenticated client but cannot
-- be trusted as an arbitrary egress target. Allow the established Web Push
-- services across browser/OS families; other services need security review.
-- Apple documents that endpoints may use any *.push.apple.com subdomain.
create or replace function public.planner_push_trusted_endpoint(value text)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select value is not null
    and length(value) <= 4096
    and value ~* '^https://(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)+push\.apple\.com|([a-z0-9-]+\.)+notify\.windows\.com)(/[^[:space:]#]*)?$';
$$;
revoke all on function public.planner_push_trusted_endpoint(text) from public, anon, authenticated;
-- The CHECK runs during authenticated inserts and updates.
grant execute on function public.planner_push_trusted_endpoint(text) to authenticated, service_role;

alter table public.planner_push_subscriptions
  drop constraint if exists planner_push_subscriptions_endpoint_https;
alter table public.planner_push_subscriptions
  add constraint planner_push_subscriptions_endpoint_https
  check (public.planner_push_trusted_endpoint(endpoint)) not valid;
alter table public.planner_push_subscriptions
  validate constraint planner_push_subscriptions_endpoint_https;
alter table public.planner_push_subscriptions
  drop constraint if exists planner_push_subscriptions_endpoint_check;

-- Bound per-account registrations as another abuse limit. The advisory lock
-- makes the cap reliable across concurrent tabs.
create or replace function public.planner_validate_push_subscription()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then
    raise exception 'Subscription owner cannot change';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Invalid device timezone';
  end if;
  if tg_op = 'INSERT' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 0));
    if not exists (
      select 1 from public.planner_push_subscriptions s
      where s.user_id = new.user_id and s.endpoint = new.endpoint
    ) and (
      select count(*) from public.planner_push_subscriptions s where s.user_id = new.user_id
    ) >= 32 then
      raise exception 'Too many push subscriptions for this account';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.planner_validate_push_subscription() from public, anon, authenticated;
grant execute on function public.planner_validate_push_subscription() to service_role;

-- Claim using the unchanged, concurrency-safe receipt/lease implementation,
-- then attach display and navigation fields from the same account's rows.
-- event_id is emitted by the existing due RPC as task:original-date:offset:ms.
-- Keeping the old RPC untouched lets the current Edge Function keep running
-- while frontend, worker, migration, and sender are deployed separately.
create or replace function public.claim_planner_push_reminders_v2(
  p_subscription_id uuid, p_limit integer default 8
) returns table (
  event_id text, task_id uuid, title text, description text, profile_name text,
  occurrence_date date, date date, "time" text, minutes_before integer,
  due_at timestamptz, lease_token uuid
) language sql volatile security definer set search_path = pg_catalog, public as $$
  select c.event_id, c.task_id, c.title,
    case when o.patch ? 'description' then o.patch->>'description' else t.description end,
    coalesce(nullif(left(btrim(p.full_name), 100), ''), 'Без назви'),
    split_part(c.event_id, ':', 2)::date, c.date, c.time,
    split_part(c.event_id, ':', 3)::integer, c.due_at, c.lease_token
  from public.claim_planner_push_reminders(p_subscription_id, p_limit) c
  join public.planner_push_subscriptions s on s.id = p_subscription_id and s.enabled
  join public.tasks t on t.id = c.task_id and t.user_id = s.user_id
  left join public.task_overrides o on o.task_id = c.task_id
    and o.occurrence_date = split_part(c.event_id, ':', 2)::date
    and o.user_id = s.user_id and not o.deleted
  left join public.profiles p on p.id = s.user_id;
$$;
revoke all on function public.claim_planner_push_reminders_v2(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_planner_push_reminders_v2(uuid, integer) to service_role;

notify pgrst, 'reload schema';
commit;
