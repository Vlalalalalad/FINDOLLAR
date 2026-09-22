-- Дата виникнення боргу відокремлена від технічної дати додавання запису.
alter table public.debts
  add column if not exists occurred_on date;

-- Для вже наявних боргів зберігаємо попередню поведінку: датою старту
-- вважається календарна дата їх створення.
update public.debts
set occurred_on = created_at::date
where occurred_on is null;

alter table public.debts
  alter column occurred_on set default current_date,
  alter column occurred_on set not null;
