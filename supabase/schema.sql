-- AX Client backend schema (Supabase / Postgres)
-- Run this in the Supabase SQL editor. The Edge Functions in
-- `supabase/functions/*` talk to these tables via the service-role key.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- ax_users: one row per Minecraft/Xbox account (xuid)
-- tier is set by the operator after a payment (e.g. via Patreon/Ko-fi webhook)
-- ---------------------------------------------------------------------------
create table if not exists public.ax_users (
  xuid        text primary key,
  tier        text not null default 'free' check (tier in ('free', 'premium')),
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- ax_sessions: short-lived opaque session tokens (hashed) + rotating refresh
-- ---------------------------------------------------------------------------
create table if not exists public.ax_sessions (
  token_hash          text primary key,
  refresh_token_hash  text not null,
  xuid                text not null references public.ax_users(xuid) on delete cascade,
  expires_at          timestamptz not null,
  created_at          timestamptz not null default now()
);

create index if not exists ax_sessions_xuid_idx on public.ax_sessions (xuid);
create index if not exists ax_sessions_refresh_idx on public.ax_sessions (refresh_token_hash);

-- ---------------------------------------------------------------------------
-- ax_cloud_profiles: one row per user + client profile (last-write-wins by rev)
-- ---------------------------------------------------------------------------
create table if not exists public.ax_cloud_profiles (
  id           uuid primary key default gen_random_uuid(),
  xuid         text not null references public.ax_users(xuid) on delete cascade,
  profile_key  text not null default 'default',
  payload      jsonb not null default '{}',
  rev          bigint not null default 0,
  updated_at   timestamptz not null default now(),
  unique (xuid, profile_key)
);

-- ---------------------------------------------------------------------------
-- updated_at helper + triggers
-- ---------------------------------------------------------------------------
create or replace function public.ax_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ax_users_updated_at on public.ax_users;
create trigger ax_users_updated_at before update on public.ax_users
  for each row execute function public.ax_set_updated_at();

drop trigger if exists ax_cloud_profiles_updated_at on public.ax_cloud_profiles;
create trigger ax_cloud_profiles_updated_at before update on public.ax_cloud_profiles
  for each row execute function public.ax_set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: everything is locked down; only the Edge Functions
-- (service-role) may read/write. The anon key must never touch these tables.
-- ---------------------------------------------------------------------------
alter table public.ax_users enable row level security;
alter table public.ax_sessions enable row level security;
alter table public.ax_cloud_profiles enable row level security;

drop policy if exists ax_users_anon on public.ax_users;
drop policy if exists ax_sessions_anon on public.ax_sessions;
drop policy if exists ax_cloud_profiles_anon on public.ax_cloud_profiles;

-- service_role bypasses RLS by default; the policies below are the explicit
-- safety net that denies everything for anon/authenticated roles.
create policy ax_users_anon on public.ax_users for all to anon, authenticated using (false) with check (false);
create policy ax_sessions_anon on public.ax_sessions for all to anon, authenticated using (false) with check (false);
create policy ax_cloud_profiles_anon on public.ax_cloud_profiles for all to anon, authenticated using (false) with check (false);

-- explicit grants for the service role (Edge Functions), required because
-- "Automatically expose new tables" is disabled in the dashboard
grant select, insert, update, delete on public.ax_users, public.ax_sessions, public.ax_cloud_profiles to service_role;
