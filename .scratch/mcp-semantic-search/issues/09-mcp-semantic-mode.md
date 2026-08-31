# 09: MCP search_bookmarks에 시맨틱 모드 연결 + 마무리

**Plan:** `docs/superpowers/plans/2026-08-31-mcp-server-semantic-search.md` (구현 순서 전체)

**What to build:** Claude에게 "그 요리 관련 북마크 찾아줘"라고 하면 의미 기반으로 찾아온다. Part 1의 MCP 도구와 Part 2의 시맨틱 검색이 여기서 합쳐지며, 이번 라운드의 원래 목표가 완성된다.

**Blocked by:** 04, 08

**Status:** ready-for-human

- [x] `search_bookmarks` 도구에 `semantic?: boolean` 파라미터 추가 — 도구 설명에 언제 켜야 하는지(의미·주제 검색) 명시해 모델이 스스로 고르게 한다
- [x] 기본값은 기존 부분일치 (하위 호환)
- [ ] Claude Code 실연결로 의미 검색 시나리오 통과
- [x] `docs/09-roadmap.md` 백로그에 **SQLite 전환** 항목 추가 — Part 0에서 "정당한 선택지이나 이번 라운드의 선행 조건은 아님"으로 판단된 건. 전환 시 임베딩 컬럼·검색 RPC를 sqlite-vec로 이식해야 함을 함께 기록
- [x] `PROGRESS.md` 갱신 — 완료 항목, 결정 로그(임베딩 프로바이더 실측 결과와 Gemini 폴백 폐기, pgvector 인덱스 미도입 근거, 웹 검색창 부분일치 유지 결정), 남은 이슈(claude.ai/Desktop 커넥터는 커스텀 헤더 미지원으로 범위 외)
- [x] `bun run typecheck && bun run lint && bun run test && bun run build` 통과
