-- Tyler Finance: push notifications.
-- Paste this whole file into Supabase → SQL Editor → New query, then tap Run.
-- Safe to run more than once.

-- One row per device that turned notifications on.
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  -- Which alerts: { bills, overspent, review, weekly }.
  prefs jsonb not null default '{"bills": true, "overspent": true, "review": true, "weekly": false}',
  time_zone text not null default 'UTC',
  hour int not null default 8 check (hour between 0 and 23),
  -- What was already sent (server only).
  memory jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists "Own devices only" on public.push_subscriptions;
create policy "Own devices only" on public.push_subscriptions
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- A small summary the app uploads when the budget changes (upcoming bills,
-- overspent categories, ...). The server reads it to decide what to send.
create table if not exists public.push_summaries (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  summary jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.push_summaries enable row level security;
drop policy if exists "Own summary only" on public.push_summaries;
create policy "Own summary only" on public.push_summaries
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- The server's push keys, created automatically on first use.
-- Row level security with no policies: only the server can read it.
create table if not exists public.push_config (
  id int primary key default 1 check (id = 1),
  public_key text not null,
  private_key text not null
);
alter table public.push_config enable row level security;

-- Check every hour who should get their daily notification.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  perform cron.unschedule('tyler-finance-push');
exception when others then null;
end;
$$;

select cron.schedule(
  'tyler-finance-push',
  '2 * * * *',
  $$
  select net.http_post(
    url := 'https://ojmtamizbzlzgqkkoopc.supabase.co/functions/v1/push',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"action": "run"}'::jsonb
  );
  $$
);
