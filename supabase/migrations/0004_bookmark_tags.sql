alter table public.bookmarks
  add column tags text[] not null default '{}';

alter table public.bookmarks
  add constraint bookmarks_tags_count_check
  check (cardinality(tags) <= 5);

create index bookmarks_tags_gin_idx
  on public.bookmarks using gin (tags);

create or replace function public.search_bookmarks(
  p_user_id uuid,
  p_query text default null,
  p_category_id uuid default null,
  p_uncategorized boolean default false,
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
    and (
      p_query is null
      or b.title ilike '%' || p_query || '%'
      or b.url ilike '%' || p_query || '%'
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

revoke all on function public.search_bookmarks(uuid,text,uuid,boolean,timestamptz,uuid,integer) from public;
grant execute on function public.search_bookmarks(uuid,text,uuid,boolean,timestamptz,uuid,integer) to service_role;
