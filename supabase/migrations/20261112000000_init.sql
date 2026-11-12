-- Trail Planner : profil athlète et courses, une ligne par utilisateur / course.
-- Les données applicatives sont stockées en JSON (même format que le stockage local).

create table if not exists public.athletes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.races (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists races_user_id_idx on public.races (user_id);

alter table public.athletes enable row level security;
alter table public.races enable row level security;

create policy "athletes: own rows" on public.athletes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "races: own rows" on public.races
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
