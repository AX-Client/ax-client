create table if not exists ax_world_transfers (
  id uuid primary key default gen_random_uuid(),
  xuid text not null,
  name text not null,
  size bigint not null default 0,
  status text not null default 'uploading',
  object_key text not null,
  expires_at timestamptz not null,
  device_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ax_world_transfers_xuid_idx on ax_world_transfers (xuid);
