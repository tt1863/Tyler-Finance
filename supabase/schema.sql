-- Tyler Finance: cloud sync table.
-- Paste this whole file into Supabase → SQL Editor → New query, then tap Run.
-- Safe to run more than once.

-- Each row is one item of a budget (an account, category, transaction, an
-- assigned amount, ...). Storing items separately lets two devices edit
-- different things at the same time without overwriting each other.
create table if not exists public.budget_records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null,
  id text not null,
  data jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, id)
);

create index if not exists budget_records_user_updated
  on public.budget_records (user_id, updated_at);

-- The server sets the time of every change, so devices with wrong clocks can't
-- confuse the sync.
create or replace function public.budget_records_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists budget_records_touch on public.budget_records;
create trigger budget_records_touch
  before insert or update on public.budget_records
  for each row execute function public.budget_records_touch();

-- Only you can see or change your own rows.
alter table public.budget_records enable row level security;

drop policy if exists "Own records only" on public.budget_records;
create policy "Own records only" on public.budget_records
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Lets other open devices hear about changes right away.
do $$
begin
  alter publication supabase_realtime add table public.budget_records;
exception when duplicate_object then null;
end;
$$;
