-- Tyler Finance: linked bank accounts (Plaid).
-- Paste this whole file into Supabase → SQL Editor → New query, then tap Run.
-- Safe to run more than once. Run supabase/schema.sql first (already done).

-- One row per bank login ("Item" in Plaid terms).
create table if not exists public.bank_items (
  id text primary key,                 -- Plaid item_id
  user_id uuid not null references auth.users (id) on delete cascade,
  institution_name text,
  status text not null default 'ok',   -- ok | login_required | error
  error text,
  cursor text,                         -- Plaid /transactions/sync position
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

-- Bank access tokens. Only the server functions can read this table: row-level
-- security is on and there are deliberately no policies, so the app (and
-- anyone with the public key) can never see it.
create table if not exists public.bank_item_secrets (
  item_id text primary key references public.bank_items (id) on delete cascade,
  access_token text not null
);

-- Accounts at each bank, and which app account each one fills.
create table if not exists public.bank_accounts (
  id text primary key,                 -- Plaid account_id
  item_id text not null references public.bank_items (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text,
  mask text,
  type text,
  subtype text,
  balance_cents bigint,
  app_account_id text,                 -- null = don't import
  import_from date,
  set_starting_balance boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.bank_items enable row level security;
alter table public.bank_item_secrets enable row level security;
alter table public.bank_accounts enable row level security;

revoke all on public.bank_item_secrets from anon, authenticated;

-- The app may read its own banks and accounts; all changes go through the
-- server functions.
drop policy if exists "Read own bank items" on public.bank_items;
create policy "Read own bank items" on public.bank_items
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Read own bank accounts" on public.bank_accounts;
create policy "Read own bank accounts" on public.bank_accounts
  for select to authenticated using (auth.uid() = user_id);
