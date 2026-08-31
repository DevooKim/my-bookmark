# 06: 임베딩 프로바이더 + 등록·수정 시 자동 임베딩

**Plan:** `docs/superpowers/plans/2026-08-31-mcp-server-semantic-search.md` (Part 2, 구현 순서 3-4)

**What to build:** 새 북마크를 등록하면 AI 분류가 끝난 직후 임베딩이 자동으로 채워진다. 제목·설명·태그를 수정하면 임베딩도 갱신된다. 임베딩 생성이 실패해도 북마크 등록은 성공하고, 사용자에게 보이는 AI 분류 상태는 오염되지 않는다.

프로바이더는 **실측으로 확정**됨 (2026-08-31): OpenRouter `/embeddings` + `openai/text-embedding-3-small`, 1536차원, 응답이 이미 L2 정규화(norm 0.99989)되어 클라이언트 정규화 코드 불필요, 배열 입력 배치 지원(`data[].index`로 순서 보장). 기존 `OPEN_ROUTER_API_KEY` 재사용 — **새 env 없음**. Gemini 폴백 경로는 폐기됨.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] `packages/ai`에 기존 분류 프로바이더와 **분리된** 임베딩 프로바이더 인터페이스 추가 — 두 인터페이스를 한 타입에 억지로 합치지 않는다. 구현은 기존 fetch + zod + 타임아웃 관례를 따르고, 응답은 zod로 파싱(타입 단언 금지)
- [ ] 배치 입력(배열) 지원 — 백필에서 쓴다
- [ ] fetch mock 단위 테스트
- [ ] `apps/api`에 임베딩 프로바이더 싱글턴 (미설정 시 null = 기능 비활성, 기존 AI 프로바이더 패턴 따름)
- [ ] 임베딩 대상 텍스트는 제목 + 설명 + 태그. URL과 메타데이터는 제외
- [ ] 훅: AI 분류 완료 지점 직후, 그리고 제목/설명/태그가 변경되는 수정 시. fire-and-forget (기존 `void … .catch(warn)` 패턴)
- [ ] **실패 시 AI 분류 상태 필드를 건드리지 않는다** — 분류 재시도 UI의 의미론이 오염된다. warn 로그 + 임베딩 null 방치로 끝내고, 복구는 백필(07)이 겸한다
- [ ] **임베딩 컬럼이 와이어 페이로드로 새지 않게 호출부에서 컬럼을 좁힌다** — 05 리뷰에서 발견된 사안. `search_bookmarks` RPC(`apps/api/src/routes/bookmarks.ts`)와 `getBookmarkForUser`의 `.select("*")`가 컬럼을 좁히지 않아, 임베딩이 채워지는 순간 목록·상세 경로가 행당 ~20KB(페이지당 ~600KB)를 Supabase→API 리전 왕복으로 끌어온다. 클라이언트 응답에는 `bookmarkSchema.parse` 때문에 새지 않지만 DB→API 구간이 낭비된다. 호출부에서 `embedding`을 제외하고, 회귀를 막는 테스트를 남길 것
- [ ] 확인: 북마크 신규 등록 후 임베딩 컬럼이 non-null
- [ ] `bun run typecheck && bun run lint && bun run test && bun run build` 통과
