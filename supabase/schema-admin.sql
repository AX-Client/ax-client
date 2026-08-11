-- AX Client admin addon (run after schema.sql in the SQL editor)
-- Adds: player names + last-seen for online stats, and the news table.

-- user enrichment -----------------------------------------------------------
alter table public.ax_users
  add column if not exists player_name text,
  add column if not exists last_seen timestamptz;

-- news ---------------------------------------------------------------------
create table if not exists public.ax_news (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null default '',
  link        text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists ax_news_created_idx on public.ax_news (created_at desc);

-- RLS: same lockdown as the core tables -------------------------------------
alter table public.ax_news enable row level security;

drop policy if exists ax_news_anon on public.ax_news;
create policy ax_news_anon on public.ax_news for all to anon, authenticated using (false) with check (false);

grant select, insert, update, delete on public.ax_news to service_role;
