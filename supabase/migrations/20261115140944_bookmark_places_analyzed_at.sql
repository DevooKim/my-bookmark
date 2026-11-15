-- 장소 분석을 마친 시각. null이면 아직 장소 분석 대상이다.
-- 장소가 원래 없는 북마크도 분석을 마치면 기록되므로, 백필이
-- "bookmark_places 행이 없음"만으로 같은 북마크를 반복 분석하지 않는다.
alter table public.bookmarks
  add column places_analyzed_at timestamptz;

-- 지금까지 백필이 ai_status = 'done' 북마크를 모두 한 번 이상 처리했으므로
-- 기존 done 행은 분석 완료로 보고 updated_at 값으로 채운다.
-- bookmarks_updated_at 트리거가 이 UPDATE로 모든 행의 updated_at을 now()로
-- 덮어쓰지 않도록 백필 동안만 끈다(같은 트랜잭션 안이라 실패 시 함께 되돌아간다).
alter table public.bookmarks disable trigger bookmarks_updated_at;

update public.bookmarks
   set places_analyzed_at = updated_at
 where ai_status = 'done';

alter table public.bookmarks enable trigger bookmarks_updated_at;
