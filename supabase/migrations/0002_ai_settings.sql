create table public.ai_settings (
  user_id                     uuid primary key references auth.users(id) on delete cascade,
  provider                    text not null default 'gemini'
                              check (provider in ('gemini', 'anthropic', 'openai')),
  gemini_api_key_encrypted    text,
  anthropic_api_key_encrypted text,
  openai_api_key_encrypted    text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create trigger ai_settings_updated_at before update on public.ai_settings
  for each row execute function public.set_updated_at();

alter table public.ai_settings enable row level security;

create policy "owner_all" on public.ai_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
