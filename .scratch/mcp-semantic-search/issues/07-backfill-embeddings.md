# 07: 기존 북마크 임베딩 백필

**Plan:** `docs/superpowers/plans/2026-08-31-mcp-server-semantic-search.md` (Part 2, 구현 순서 5)

**What to build:** 이미 쌓여 있는 ~1,000건의 북마크가 모두 의미 검색 대상이 된다. 06은 앞으로 들어오는 것만 임베딩하므로, 과거 데이터를 메우는 일회성(겸 상시 복구용) 스크립트가 필요하다.

전체 백필 1회 비용은 실측 기준 약 $0.004다.

**Blocked by:** 06

**Status:** ready-for-human

- [x] 백필 스크립트 — 기존 seed 스크립트의 env 로딩 + admin 클라이언트 패턴을 따른다
- [x] 임베딩이 비어 있는 북마크만 대상 (재실행 안전 — 06의 실패 건을 나중에 자연히 복구한다)
- [x] `--dry-run`과 `--limit` 지원
- [x] 배치 입력 활용, 실패한 건은 로그에 남기고 계속 진행
- [ ] 실행 후 임베딩이 비어 있는 북마크 0건 확인
- [x] `bun run typecheck && bun run lint && bun run test && bun run build` 통과
