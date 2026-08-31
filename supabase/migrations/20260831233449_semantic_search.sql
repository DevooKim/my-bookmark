create extension if not exists vector with schema extensions;

alter table public.bookmarks
  add column embedding extensions.vector(1536);

-- At the current scale of roughly 1,000 bookmarks, a sequential scan is only a
-- few milliseconds. Defer HNSW until the table approaches 100,000 rows so the
-- index does not add write, storage, and migration cost prematurely.
create function public.semantic_search_bookmarks(
  p_user_id uuid,
  p_embedding extensions.vector(1536),
  p_limit integer default 20,
  p_max_distance double precision default 0.6
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
    and b.embedding is not null
    and (
      b.embedding operator(extensions.<=>) p_embedding
    ) <= p_max_distance
  order by b.embedding operator(extensions.<=>) p_embedding
  limit least(greatest(p_limit, 1), 100);
$$;

revoke all on function public.semantic_search_bookmarks(
  uuid,
  extensions.vector,
  integer,
  double precision
) from public;

grant execute on function public.semantic_search_bookmarks(
  uuid,
  extensions.vector,
  integer,
  double precision
) to service_role;
