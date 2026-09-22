create extension if not exists "pgcrypto";

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  base_currency text not null default 'UAH',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('cash','card','bank','crypto','wallet','other')),
  currency text not null default 'UAH',
  starting_balance numeric(18,8) not null default 0,
  is_locked boolean not null default false,
  color text not null default '#0E8F6E',
  is_archived boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.categories(id) on delete set null,
  name text not null,
  type text not null check (type in ('income','expense')),
  color text not null default '#0E8F6E',
  icon text,
  is_archived boolean not null default false,
  is_default boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  direction text not null check (direction in ('owed_to_me','i_owe')),
  counterparty text not null,
  amount numeric(18,2) not null check (amount > 0),
  currency text not null default 'UAH',
  due_date date,
  status text not null default 'open' check (status in ('open','partially_paid','paid','overdue','cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  transfer_to_account_id uuid references public.accounts(id) on delete set null,
  account_name_snapshot text,
  transfer_to_account_name_snapshot text,
  category_id uuid references public.categories(id) on delete set null,
  debt_id uuid references public.debts(id) on delete set null,
  is_cancelled boolean not null default false,
  type text not null check (type in ('income','expense','transfer')),
  amount numeric(18,8) not null check (amount > 0),
  currency text not null default 'UAH',
  description text,
  mood text check (mood in ('great','neutral','regret')),
  tags text[] not null default '{}',
  is_pinned boolean not null default false,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transfer_needs_target check (
    transfer_to_account_id is null or transfer_to_account_id <> account_id
  )
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  status text not null default 'planned' check (status in ('planned','in_progress','done','postponed')),
  due_at timestamptz,
  recurrence text not null default 'none' check (recurrence in ('none','daily','weekly','monthly')),
  linked_transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.recurring_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  amount numeric(18,2) not null,
  currency text not null default 'UAH',
  account_id uuid references public.accounts(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  frequency text not null check (frequency in ('daily','weekly','monthly','yearly')),
  next_due_date date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.mini_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  invested_amount numeric(18,2) not null default 0,
  fees_amount numeric(18,2) not null default 0,
  result_amount numeric(18,2) not null default 0,
  currency text not null default 'UAH',
  pnl numeric(18,2) generated always as (result_amount - invested_amount - fees_amount) stored,
  notes text,
  created_at timestamptz not null default now()
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  amount numeric(18,2) not null,
  period text not null default 'monthly' check (period in ('weekly','monthly','yearly')),
  created_at timestamptz not null default now()
);

create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  target_amount numeric(18,2) not null,
  current_amount numeric(18,2) not null default 0,
  currency text not null default 'UAH',
  target_date date,
  account_id uuid references public.accounts(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in ('transaction','debt','task','mini_check')),
  entity_id uuid not null,
  file_path text not null,
  file_name text,
  created_at timestamptz not null default now()
);

create table public.transaction_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  account_id uuid references public.accounts(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  type text not null check (type in ('income','expense','transfer')),
  amount numeric(18,2),
  description text,
  created_at timestamptz not null default now()
);

create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  currency text not null,
  rate_to_base numeric(18,8) not null check (rate_to_base > 0),
  updated_at timestamptz not null default now(),
  unique (user_id, currency)
);

create index idx_accounts_user on public.accounts (user_id);
create index idx_categories_user on public.categories (user_id);
create index idx_debts_user on public.debts (user_id);
create index idx_transactions_user on public.transactions (user_id);
create index idx_transactions_account on public.transactions (account_id);
create index idx_transactions_occurred on public.transactions (occurred_at desc);
create index idx_transactions_cancelled on public.transactions (is_cancelled);
create index idx_tasks_user on public.tasks (user_id);
create index idx_attachments_entity on public.attachments (entity_type, entity_id);
create index idx_exchange_rates_user on public.exchange_rates (user_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated before update on public.profiles for each row execute procedure public.set_updated_at();
create trigger trg_accounts_updated before update on public.accounts for each row execute procedure public.set_updated_at();
create trigger trg_debts_updated before update on public.debts for each row execute procedure public.set_updated_at();
create trigger trg_transactions_updated before update on public.transactions for each row execute procedure public.set_updated_at();
create trigger trg_tasks_updated before update on public.tasks for each row execute procedure public.set_updated_at();
create trigger trg_exchange_rates_updated before update on public.exchange_rates for each row execute procedure public.set_updated_at();

create or replace function public.seed_default_categories(uid uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.categories (user_id, name, type, color, sort_order, is_default) values
    (uid, 'Зарплата', 'income', '#0E8F6E', 1, true),
    (uid, 'Фріланс', 'income', '#2E7DD6', 2, true),
    (uid, 'Подарунки', 'income', '#C25B9E', 3, true),
    (uid, 'Інвестиції', 'income', '#7C5FD1', 4, true),
    (uid, 'Інший дохід', 'income', '#6B6A63', 5, true),
    (uid, 'Їжа', 'expense', '#C9772E', 1, true),
    (uid, 'Транспорт', 'expense', '#2E93C9', 2, true),
    (uid, 'Житло', 'expense', '#7C5FD1', 3, true),
    (uid, 'Розваги', 'expense', '#C25B9E', 4, true),
    (uid, 'Здоров''я', 'expense', '#B5432E', 5, true),
    (uid, 'Одяг', 'expense', '#2EA88F', 6, true),
    (uid, 'Освіта', 'expense', '#C98A1D', 7, true),
    (uid, 'Підписки', 'expense', '#5B6CE0', 8, true),
    (uid, 'Інші витрати', 'expense', '#6B6A63', 9, true);
end;
$$;

create or replace function public.ensure_default_categories()
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (select 1 from public.categories where user_id = auth.uid()) then
    perform public.seed_default_categories(auth.uid());
  end if;
end;
$$;

grant execute on function public.ensure_default_categories() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  perform public.seed_default_categories(new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.snapshot_account_name_before_delete()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.transactions set account_name_snapshot = old.name where account_id = old.id;
  update public.transactions set transfer_to_account_name_snapshot = old.name where transfer_to_account_id = old.id;
  return old;
end;
$$;

create trigger trg_accounts_snapshot_name_before_delete
  before delete on public.accounts
  for each row execute procedure public.snapshot_account_name_before_delete();

create or replace function public.delete_my_data()
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.attachments where user_id = auth.uid();
  delete from public.transaction_templates where user_id = auth.uid();
  delete from public.savings_goals where user_id = auth.uid();
  delete from public.budgets where user_id = auth.uid();
  delete from public.mini_checks where user_id = auth.uid();
  delete from public.recurring_payments where user_id = auth.uid();
  delete from public.tasks where user_id = auth.uid();
  delete from public.transactions where user_id = auth.uid();
  delete from public.debts where user_id = auth.uid();
  delete from public.exchange_rates where user_id = auth.uid();
  delete from public.categories where user_id = auth.uid() and is_default = false;
  delete from public.accounts where user_id = auth.uid();
  update public.profiles set full_name = null, base_currency = 'UAH' where id = auth.uid();
end;
$$;

grant execute on function public.delete_my_data() to authenticated;

alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.debts enable row level security;
alter table public.transactions enable row level security;
alter table public.tasks enable row level security;
alter table public.recurring_payments enable row level security;
alter table public.mini_checks enable row level security;
alter table public.budgets enable row level security;
alter table public.savings_goals enable row level security;
alter table public.attachments enable row level security;
alter table public.transaction_templates enable row level security;
alter table public.exchange_rates enable row level security;

create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "accounts_all_own" on public.accounts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "categories_all_own" on public.categories for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "debts_all_own" on public.debts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "transactions_all_own" on public.transactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tasks_all_own" on public.tasks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "recurring_payments_all_own" on public.recurring_payments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "mini_checks_all_own" on public.mini_checks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "budgets_all_own" on public.budgets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "savings_goals_all_own" on public.savings_goals for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "attachments_all_own" on public.attachments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "templates_all_own" on public.transaction_templates for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "exchange_rates_all_own" on public.exchange_rates for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

create policy "attachments_storage_owner_select" on storage.objects for select
  using (bucket_id = 'attachments' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "attachments_storage_owner_insert" on storage.objects for insert
  with check (bucket_id = 'attachments' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "attachments_storage_owner_update" on storage.objects for update
  using (bucket_id = 'attachments' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "attachments_storage_owner_delete" on storage.objects for delete
  using (bucket_id = 'attachments' and auth.uid()::text = (storage.foldername(name))[1]);
