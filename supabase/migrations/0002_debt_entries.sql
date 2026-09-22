create table public.debt_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  debt_id uuid not null references public.debts(id) on delete cascade,
  kind text not null check (kind in ('increase','repayment')),
  amount numeric(18,2) not null check (amount > 0),
  description text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_debt_entries_debt on public.debt_entries (debt_id);
create index idx_debt_entries_user on public.debt_entries (user_id);

alter table public.debt_entries enable row level security;

create policy "debt_entries_all_own" on public.debt_entries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
