# 01: 북마크·카테고리 조회 로직을 서비스 함수로 추출

**Plan:** `docs/superpowers/plans/2026-08-31-mcp-server-semantic-search.md` (Part 1, 구현 순서 2)

**What to build:** 사용자에게 보이는 동작은 하나도 바뀌지 않는다. 북마크 목록 조회·북마크 단건 조회·카테고리 목록 조회 로직이 라우터 핸들러 안에 인라인으로 박혀 있어 HTTP 요청 없이는 호출할 수 없는 상태다. 이를 `userId`를 받는 export 함수로 끌어내, 뒤이어 붙일 MCP 도구가 같은 로직을 재사용할 수 있게 한다. API 키 검증기도 주입 가능하도록 export한다.

"Make the change easy, then make the easy change" — 이 티켓이 그 앞쪽 절반이다.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] 목록 조회(검색 파라미터 빌드 + RPC 호출 + 미디어 서명 URL 매핑), 단건 조회, 카테고리 목록이 각각 export 함수로 분리됨
- [x] 기존 라우터 핸들러는 추출된 함수를 호출하는 얇은 껍데기가 됨 — 응답 JSON 구조·에러 코드·커서 인코딩 모두 불변
- [x] 기본 API 키 검증기가 export되어 테스트에서 주입 가능
- [x] 기존 테스트 스위트가 수정 없이 통과 (회귀 그물 역할 — 테스트를 고쳐야 한다면 동작이 바뀐 것이므로 코드를 고칠 것)
- [x] `bun run typecheck && bun run lint && bun run test && bun run build` 통과
