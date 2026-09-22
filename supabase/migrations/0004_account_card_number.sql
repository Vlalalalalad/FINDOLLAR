-- Optional payment-card / account number stored with the account itself.
alter table public.accounts
  add column if not exists card_number text;
