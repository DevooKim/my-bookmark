-- updated_at 자동 갱신
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 50),
  color       text,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);

create table public.bookmarks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  url          text not null check (url ~ '^https?://'),
  title        text,
  description  text,
  site_name    text,
  favicon_url  text,
  og_image_url text,
  category_id  uuid references public.categories(id) on delete set null,
  ai_status    text not null default 'idle'
               check (ai_status in ('idle','pending','done','failed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, url)
);
create index bookmarks_user_created_idx on public.bookmarks (user_id, created_at desc, id desc);
create index bookmarks_category_idx     on public.bookmarks (category_id);
create trigger bookmarks_updated_at before update on public.bookmarks
  for each row execute function public.set_updated_at();

create table public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  key_hash     text not null unique,
  key_prefix   text not null,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create table public.reminders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  bookmark_id uuid not null references public.bookmarks(id) on delete cascade,
  remind_at   timestamptz not null,
  note        text,
  status      text not null default 'pending'
              check (status in ('pending','sent','cancelled')),
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index reminders_due_idx on public.reminders (status, remind_at);

alter table public.categories         enable row level security;
alter table public.bookmarks          enable row level security;
alter table public.api_keys           enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminders          enable row level security;

create policy "owner_all" on public.categories
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "owner_all" on public.bookmarks
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "owner_all" on public.api_keys
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "owner_all" on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "owner_all" on public.reminders
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
