create table public.ai_usage_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  provider    text not null check (provider in ('gemini', 'anthropic', 'openai')),
  model       text not null,
  bookmark_id uuid references public.bookmarks(id) on delete set null,
  status      text not null check (status in ('success', 'failed')),
  error_code  text,
  duration_ms int,
  created_at  timestamptz not null default now()
);
create index ai_usage_events_user_created_idx
  on public.ai_usage_events (user_id, created_at desc);

alter table public.ai_usage_events enable row level security;

create policy "owner_all" on public.ai_usage_events
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
