# PROGRESS — 구현 진행 로그

> 에이전트는 매 작업 세션 종료 시 이 파일을 갱신한다. 형식을 유지할 것.

## 현재 상태

- **현재 Phase**: Phase 0 완료 (다음 작업: Phase 1)
- **최종 갱신**: 2026-07-06 (Phase 0 모노레포 스캐폴딩 완료)

## Phase 체크리스트

- [x] Phase 0 — 모노레포 스캐폴딩
- [ ] Phase 1 — DB + 인증 (선행: 사용자의 Supabase 프로젝트 설정 필요 → docs/04-auth.md)
- [ ] Phase 2 — 북마크 + 카테고리 CRUD
- [ ] Phase 3 — AI 카테고리 분류
- [ ] Phase 4 — API Key + iOS 단축어
- [ ] Phase 5 — PWA
- [ ] Phase 6 — Web Push + 리마인더
- [ ] Phase 7 — 성능 + Docker + 마무리

## 결정 로그 (스펙과 다르게 한 것, 스펙에 없어서 정한 것)

| 날짜 | 결정 | 이유 |
|---|---|---|
| 2026-07-06 | TanStack Start CLI가 `@tanstack/create-start` deprecation 경고를 냈지만, 로드맵 요구대로 공식 `pnpm create @tanstack/start@latest`로 스캐폴딩하고 현행 CLI 출력물을 이식했다. | 공식 CLI의 현재 API/구조를 우선한다는 docs/01-architecture 지침 준수. |
| 2026-07-06 | Phase 0 API env 검증은 `PORT`, `WEB_ORIGIN`, `NODE_ENV` 기본값을 제공하고 Supabase/AI/Push 값은 optional로 두었다. | Phase 1 전에는 Supabase 값이 준비되지 않아도 `/api/health`와 dev 서버 수용 기준을 검증할 수 있어야 함. Phase 1에서 인증 구현 시 필요한 값들을 강화할 예정. |
| 2026-07-06 | TanStack Router 생성 파일 `**/routeTree.gen.ts`를 Biome 검사에서 제외했다. | 생성 파일에 `any`가 포함되며, 파일 자체 주석도 lint/format 제외를 권장함. |

## 알려진 이슈 / 기술 부채

- Phase 1에서 Supabase/Auth 구현 시 `apps/api/src/lib/env.ts`의 Supabase 관련 env를 필수로 강화해야 한다.

## 배포 후 TODO

- iOS 실기기에서 홈 화면 설치 → 푸시 수신 확인 (HTTPS 필요, Phase 6 참조)
