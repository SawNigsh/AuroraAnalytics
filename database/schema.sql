create table if not exists public.sessions (
  id uuid primary key,
  client_id text not null,
  script_version text not null default 'unknown',
  executor text not null default 'unknown',
  place_id text not null default '0',
  job_id text not null default 'unknown',
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz null,
  duration_seconds integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists sessions_started_at_idx on public.sessions (started_at desc);
create index if not exists sessions_last_seen_at_idx on public.sessions (last_seen_at desc);
create index if not exists sessions_client_id_idx on public.sessions (client_id);

alter table public.sessions enable row level security;

-- The Express backend uses the Supabase service-role key, so no public policies
-- are required for the API. Keep the service-role key server-side only.
