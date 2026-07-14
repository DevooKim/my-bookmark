alter table public.reminders
  add column recurrence text not null default 'none'
    check (recurrence in ('none', 'daily', 'weekly', 'monthly')),
  add column recurrence_timezone text not null default 'UTC',
  add column recurrence_day smallint
    check (recurrence_day between 1 and 31),
  add column is_enabled boolean not null default true;

drop index if exists public.reminders_due_idx;
create index reminders_due_idx
  on public.reminders (status, is_enabled, remind_at);
