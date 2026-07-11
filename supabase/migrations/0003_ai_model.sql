alter table public.ai_settings add column model text;

update public.ai_settings
set model = case provider
  when 'anthropic' then 'claude-haiku-4-5'
  when 'openai' then 'gpt-4o-mini'
  else 'gemini-flash-lite-latest'
end;

alter table public.ai_settings
  alter column model set default 'gemini-flash-lite-latest',
  alter column model set not null,
  add constraint ai_settings_provider_model_check check (
    (provider = 'gemini' and model in (
      'gemini-flash-lite-latest',
      'gemini-flash-latest'
    )) or
    (provider = 'anthropic' and model in (
      'claude-haiku-4-5',
      'claude-sonnet-4-6'
    )) or
    (provider = 'openai' and model in (
      'gpt-4o-mini',
      'gpt-5.4-mini'
    ))
  );
