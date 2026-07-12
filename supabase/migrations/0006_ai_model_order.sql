alter table public.ai_settings
  add column model_order text[] not null default '{}';

update public.ai_settings
set model_order = array[model];

alter table public.bookmarks
  add column ai_model text;
