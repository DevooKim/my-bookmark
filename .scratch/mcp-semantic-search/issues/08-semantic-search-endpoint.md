# 08: 시맨틱 검색 엔드포인트

**Plan:** `docs/superpowers/plans/2026-08-31-mcp-server-semantic-search.md` (Part 2, 구현 순서 4)

**What to build:** "맛집"으로 검색하면 제목에 "식당"만 있는 북마크가 잡힌다 — 현재 `ilike '%q%'` 부분일치가 구조적으로 놓치는 결과다. 기존 검색 엔드포인트는 그대로 두고 별도 경로로 추가한다.

**웹 검색창은 기존 부분일치를 유지한다.** 300ms debounce마다 임베딩 API를 호출하는 건 부적합하고, 이 엔드포인트의 1차 소비자는 MCP 도구(09)다.

하이브리드 랭킹(RRF)은 이 규모에서 과설계 — **하지 않는다.**

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] `GET /bookmarks/search/semantic?q=` — 쿼리 스키마는 `packages/shared`의 zod로 정의
- [ ] 쿼리를 임베딩 → 05의 RPC 호출 → 기존 미디어 서명 URL 매핑 재사용. 응답 형태는 기존 목록 엔드포인트와 일관되게
- [ ] 임베딩 프로바이더 미설정 시 명확한 에러 (조용히 빈 결과 반환 금지)
- [ ] 거리 임계값은 0.6에서 시작해, 아래 비교 결과를 보고 조정
- [ ] 05의 RPC는 거리 값을 반환하지 않는다(`returns setof public.bookmarks`). 임계값 튜닝 근거는 엔드포인트만으로는 얻을 수 없으므로 Supabase SQL 에디터에서 직접 거리 분포를 조회해 확보할 것 — 응답 계약을 바꿔 거리를 노출하지는 않는다
- [ ] **품질 검증**: 부분일치가 놓치는 동의어 쿼리 5~10개("맛집"↔"식당" 등)를 기존/시맨틱 엔드포인트에 각각 던져 결과 비교. 임계값 근거를 결정 로그에 남길 것
- [ ] `bun run typecheck && bun run lint && bun run test && bun run build` 통과
