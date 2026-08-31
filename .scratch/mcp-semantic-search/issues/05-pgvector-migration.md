# 05: pgvector 마이그레이션

**Plan:** `docs/superpowers/plans/2026-08-31-mcp-server-semantic-search.md` (Part 2, 구현 순서 2)

**What to build:** DB가 의미 검색을 받을 준비를 갖춘다 — 북마크마다 임베딩 벡터를 담을 자리와, 쿼리 벡터로 가까운 북마크를 뽑는 RPC가 생긴다. 이 티켓만으로는 사용자에게 보이는 변화가 없지만, 이후 Part 2 전체의 관문이다.

**이 티켓은 사람 손을 탄다:** 마이그레이션 SQL 작성은 에이전트가 하고, `supabase db push`는 **사용자가 직접** 실행한다(프로젝트 규율). 사용자 push 확인까지가 완료다.

**Blocked by:** None (can start immediately)

**Status:** ready-for-human

- [x] `vector` 확장을 `extensions` 스키마에 생성
- [x] 북마크에 `embedding vector(1536)` 컬럼 추가 — 1536은 실측으로 확정된 차원(OpenRouter `openai/text-embedding-3-small`)
- [x] `semantic_search_bookmarks(p_user_id, p_embedding vector(1536), p_limit, p_max_distance)` RPC — top-N 단일 페이지, 커서 없음. 사용자 소유 행만 반환
- [x] **인덱스 없음** — 1,000건 순차 스캔이 수 ms다. HNSW가 왜 아직 불필요한지(10만 건 전까지) SQL 주석으로 기록
- [x] 코사인 거리(`<=>`) 사용 — 프로바이더 응답이 이미 L2 정규화되어 있음
- [x] **함정**: 기존 마이그레이션 규율인 `set search_path = ''` 때문에 벡터 연산자를 `operator(extensions.<=>)`로 완전 수식해야 한다. 수식하지 않으면 함수 실행 시점에 연산자를 못 찾는다
- [x] grant는 기존 RPC 패턴(service_role만)을 따른다
- [ ] 사용자가 `supabase db push` 실행 완료, 컬럼·RPC 존재 확인
