# PROGRESS — 구현 진행 로그

> 에이전트는 매 작업 세션 종료 시 이 파일을 갱신한다. 형식을 유지할 것.

## 현재 상태

- **현재 Phase**: Phase 1 진행 중 (DB push/실제 로그인 검증 대기)
- **최종 갱신**: 2026-07-06 (Phase 1 DB/Auth 코드 구현, Supabase CLI 인증 대기)

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
| 2026-07-06 | Phase 1에서 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`는 test 외 환경 필수로 강화하고, 테스트 환경만 optional로 유지했다. | 인증/API 테스트는 Supabase 실제 값 없이도 실행되어야 하지만 dev/prod 서버는 잘못된 설정으로 뜨면 안 된다. |
| 2026-07-06 | Supabase CLI를 루트 devDependency로 추가하고 `supabase init` 결과를 커밋 대상으로 포함했다. | 마이그레이션 관리를 저장소 명령(`pnpm exec supabase ...`)으로 재현 가능하게 하기 위함. |

## 알려진 이슈 / 기술 부채

- Phase 1 DB/Auth 코드 구현과 정적 검증은 완료됐지만, `supabase link/db push`는 로컬 Supabase access token 부재로 미실행 상태다. 사용자가 `supabase login` 또는 `SUPABASE_ACCESS_TOKEN` 제공 후 `pnpm exec supabase link --project-ref <ref>` 및 `pnpm exec supabase db push`를 실행해야 한다.
- Supabase 대시보드의 가입 차단(Allow new users to sign up OFF)과 사용자 1개 생성은 에이전트가 확인할 수 없어 사용자 확인 필요.

## 배포 후 TODO

- iOS 실기기에서 홈 화면 설치 → 푸시 수신 확인 (HTTPS 필요, Phase 6 참조)
