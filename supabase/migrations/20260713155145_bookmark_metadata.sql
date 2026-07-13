alter table public.bookmarks
  add column metadata jsonb not null default '{}'::jsonb,
  add constraint bookmarks_metadata_object_check
    check (jsonb_typeof(metadata) = 'object');
