create extension if not exists vector with schema extensions;

alter table public.bookmarks
  add column embedding extensions.vector(1536);

-- 벡터 인덱스는 의도적으로 만들지 않는다:
-- 현재 약 1,000건에서는 순차 스캔이 수 ms에 불과하다. 쓰기·저장 공간·마이그레이션
-- 비용을 불필요하게 늘리지 않도록 약 10만 건 전까지 HNSW를 보류한다.
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
      p_max_distance is null
      or (
        b.embedding operator(extensions.<=>) p_embedding
      ) <= p_max_distance
    )
  order by b.embedding operator(extensions.<=>) p_embedding
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
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
