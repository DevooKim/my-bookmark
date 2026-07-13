alter table public.bookmarks
  drop constraint if exists bookmarks_url_check,
  drop constraint if exists bookmarks_user_id_url_key,
  alter column url drop not null,
  add column kind text not null default 'link',
  add column image_original_path text,
  add column image_thumbnail_path text,
  add column image_mime_type text,
  add column image_file_size bigint,
  add column image_width integer,
  add column image_height integer,
  add column image_filename text;

alter table public.bookmarks
  add constraint bookmarks_kind_check
    check (kind in ('link', 'image')),
  add constraint bookmarks_content_check
    check (
      (
        kind = 'link'
        and url ~ '^https?://'
        and image_original_path is null
        and image_thumbnail_path is null
        and image_mime_type is null
        and image_file_size is null
        and image_width is null
        and image_height is null
        and image_filename is null
      )
      or
      (
        kind = 'image'
        and url is null
        and image_original_path is not null
        and image_thumbnail_path is not null
        and image_mime_type like 'image/%'
        and image_file_size > 0
        and image_width > 0
        and image_height > 0
        and char_length(image_filename) between 1 and 255
      )
    );

create unique index bookmarks_user_url_unique
  on public.bookmarks (user_id, url)
  where kind = 'link';

create index bookmarks_user_kind_created_idx
  on public.bookmarks (user_id, kind, created_at desc, id desc);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'bookmark-images',
  'bookmark-images',
  false,
  20971520,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop function if exists public.search_bookmarks(
  uuid,
  text,
  uuid,
  boolean,
  timestamptz,
  uuid,
  integer
);

create function public.search_bookmarks(
  p_user_id uuid,
  p_query text default null,
  p_category_id uuid default null,
  p_uncategorized boolean default false,
  p_kind text default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 31
)
returns setof public.bookmarks
language sql
stable
security invoker
set search_path = ''
as $$
  select b.*
  from public.bookmarks b
  where b.user_id = p_user_id
    and (not p_uncategorized or b.category_id is null)
    and (p_category_id is null or b.category_id = p_category_id)
    and (p_kind is null or b.kind = p_kind)
    and (
      p_query is null
      or b.title ilike '%' || p_query || '%'
      or coalesce(b.url, '') ilike '%' || p_query || '%'
      or b.description ilike '%' || p_query || '%'
      or exists (
        select 1 from unnest(b.tags) tag
        where tag ilike '%' || p_query || '%'
      )
    )
    and (
      p_cursor_created_at is null
      or (b.created_at, b.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by b.created_at desc, b.id desc
  limit least(greatest(p_limit, 1), 101);
$$;

revoke all on function public.search_bookmarks(
  uuid,
  text,
  uuid,
  boolean,
  text,
  timestamptz,
  uuid,
  integer
) from public;

grant execute on function public.search_bookmarks(
  uuid,
  text,
  uuid,
  boolean,
  text,
  timestamptz,
  uuid,
  integer
) to service_role;
