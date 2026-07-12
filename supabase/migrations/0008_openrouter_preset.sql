drop table public.ai_settings;

alter table public.ai_usage_events
  drop constraint if exists ai_usage_events_provider_check;
