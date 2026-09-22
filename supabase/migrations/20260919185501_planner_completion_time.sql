-- Additive: no rows, recurrence definitions or RLS policies are replaced.
alter table public.tasks add column if not exists completed_at timestamptz;
alter table public.task_overrides add column if not exists completed_at timestamptz;

-- Legacy rows have no historical completion instant. Keep their existing
-- updated_at as a fallback, and freeze that fallback on the first later edit.
-- New completion/undo/recompletion transitions are always stamped by Postgres.
create or replace function public.planner_stamp_completion()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status::text is distinct from tg_argv[0] then
    new.completed_at := null;
  elsif tg_op = 'INSERT' then
    new.completed_at := statement_timestamp();
  elsif old.status::text is distinct from tg_argv[0] then
    new.completed_at := statement_timestamp();
  else
    new.completed_at := coalesce(old.completed_at, old.updated_at);
  end if;
  return new;
end;
$$;
revoke all on function public.planner_stamp_completion() from public;

create trigger planner_tasks_completion_stamp
before insert or update on public.tasks
for each row execute function public.planner_stamp_completion('done');
create trigger planner_overrides_completion_stamp
before insert or update on public.task_overrides
for each row execute function public.planner_stamp_completion('completed');
