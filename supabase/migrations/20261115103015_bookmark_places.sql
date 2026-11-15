create table public.bookmark_places (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  bookmark_id    uuid not null references public.bookmarks(id) on delete cascade,
  position       integer not null,
  name           text not null,
  locality       text,
  country_code   text check (country_code ~ '^[A-Z]{2}$'),
  geocode_status text not null default 'pending'
                 check (geocode_status in ('pending','resolved','not_found','skipped')),
  lat            double precision,
  lng            double precision,
  address        text,
  road_address   text,
  created_at     timestamptz not null default now(),
  unique (bookmark_id, position),
  check ((geocode_status = 'resolved') = (lat is not null and lng is not null))
);

create index bookmark_places_user_idx on public.bookmark_places (user_id);
create index bookmark_places_bookmark_idx on public.bookmark_places (bookmark_id);

alter table public.bookmark_places enable row level security;

create policy "owner_all" on public.bookmark_places
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
