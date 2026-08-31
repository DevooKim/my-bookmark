# 04: add_bookmark 도구 + 원격 배포 확인

**Plan:** `docs/superpowers/plans/2026-08-31-mcp-server-semantic-search.md` (Part 1, 도구 4종 / Verification)

**What to build:** Claude 대화 중 URL을 건네면 북마크로 등록되고, 기존 AI 분류·요약 파이프라인이 그대로 돈다. 이미 저장된 URL은 실패가 아니라 "이미 저장됨"이라는 읽을 수 있는 응답으로 돌아온다 — 사람이 대화하는 창구이므로 중복은 에러가 아니라 정보다. 마지막으로 원격 배포본에서도 같은 연결이 되는지 확인한다.

이 티켓이 Part 1의 유일한 **쓰기** 도구다.

**Blocked by:** 02

**Status:** ready-for-human

- [x] `add_bookmark` — 기존 링크 북마크 생성 함수를 AI 분류 모드로 재사용 (share 라우터가 이미 재사용하는 선례를 따른다). 새 생성 경로를 만들지 않을 것
- [x] URL 중복(409) 시 예외가 아니라 "이미 저장됨" 취지의 텍스트 결과로 변환
- [x] tools call 테스트: 신규 등록 / 중복 URL 두 경로
- [ ] `docker compose build api && docker compose up -d` 후, Caddy 프록시 경유 원격 URL(`https://<도메인>/api/mcp`)로 `claude mcp add` 연결 및 도구 4종 실행 확인 — 인프라 설정 변경이 필요 없어야 한다(이미 `/api/*`가 프록시됨)
- [x] `bun run typecheck && bun run lint && bun run test && bun run build` 통과
