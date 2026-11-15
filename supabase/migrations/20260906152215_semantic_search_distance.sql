-- 로컬 품질 검증(2026-09-06): 기본 거리 0.6은 짧은 한국어 동의어
-- (식당/옷/운동/패션)를 관련 북마크가 있어도 전부 잘랐다. 0.8에서 해당
-- 결과가 살아나고 구 쿼리(맛있는 곳, 코딩 도구) 품질은 유지됐다.
-- 1.0/무제한은 무관 결과로 상위가 채워져 채택하지 않는다.
create or replace function public.semantic_search_bookmarks(
  p_user_id uuid,
  p_embedding extensions.vector(1536),
  p_limit integer default 20,
  p_max_distance double precision default 0.8
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
