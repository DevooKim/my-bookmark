# PROGRESS — 구현 진행 로그

> 에이전트는 매 작업 세션 종료 시 이 파일을 갱신한다. 형식을 유지할 것.

## 현재 상태

- **현재 Phase**: Phase 2 구현 완료 (자동 검증 + 실제 계정 API E2E 통과, 브라우저 UI 조작 확인은 사용자/브라우저 확인 필요). 다음: Phase 3
- **최종 갱신**: 2026-07-07 (Phase 2 리뷰 지적 수정 — 카테고리 소유권 검증, metadata user_id 필터, DNS SSRF 방어, 인라인 카테고리 생성/무한 스크롤)

## Phase 체크리스트

- [x] Phase 0 — 모노레포 스캐폴딩
- [x] Phase 1 — DB + 인증
- [x] Phase 2 — 북마크 + 카테고리 CRUD
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
| 2026-07-07 | `requireAuth`에 verifier 주입 파라미터(`requireAuth(verify = bearerAuth)`)를 추가하고, supertest로 HTTP 경계 통합 테스트를 작성했다(유효/만료/변조/헤더누락/비-bearer 스킴). | 로드맵 Phase 1의 "auth 미들웨어 단위 테스트" 요구는 순수 함수(`createBearerAuth`)가 아니라 실제 미들웨어(`requireAuth`)의 헤더 파싱·에러 전달 경로를 덮어야 충족된다. 리뷰 지적(HIGH). |
| 2026-07-07 | `GET /api/me`의 `userId ?? ""` 폴백을 제거하고 `getUserId(request)` 헬퍼(userId 없으면 500)로 교체했다. | 도달 불가능한 폴백이 미들웨어 우회 버그를 서버 500이 아니라 클라 zod 파싱 에러로 밀어냈다. 리뷰 지적(MED). |
| 2026-07-07 | `createBearerAuth`가 jose의 키 해결 실패(`ERR_JWKS_TIMEOUT`/`NO_MATCHING_KEY`/`MULTIPLE_MATCHING_KEYS`)를 401이 아닌 502로 응답하도록 분기했다. | JWKS 엔드포인트 일시 장애를 "토큰 무효(401)"로 뭉개면 유효 세션 사용자가 refresh 루프 끝에 로그아웃당한다. 리뷰 지적(LOW). |
| 2026-07-07 | Phase 2의 `mode=ai` 등록은 501로 두고, 웹 추가 다이얼로그의 AI 자동 옵션을 비활성화했다. | 로드맵 Phase 2는 AI를 다음 Phase로 미루며 `ai`는 501 또는 metadata만 허용한다. 사용자 혼동을 막기 위해 UI에서는 "다음 업데이트"로 표시했다. |
| 2026-07-07 | Biome CSS parser에 `tailwindDirectives`를 활성화했다. | Tailwind CSS v4의 `@custom-variant`/`@apply`를 사용하는 공용 UI 클래스가 Biome에서 파싱되어야 lint/format 검증을 통과한다. |
| 2026-07-07 | Supabase/agent skill 파일(`.agents`, `.claude/skills/supabase-server`, `skills-lock.json`)을 별도 커밋으로 추적했다. | 개인 프로젝트라 작업 지침/스킬 버전을 저장소에 고정해 세션 재현성을 높이는 편이 유리하다. |
| 2026-07-07 | Phase 2 리뷰 지적에 따라 북마크 생성/수정 시 카테고리 소유권을 서버에서 검증하고, 백그라운드 metadata 업데이트에도 `user_id` 필터를 추가했다. | Express secret key는 RLS를 우회하므로 모든 DB 변경에 사용자 경계를 명시해야 한다. |
| 2026-07-07 | metadata SSRF 방어를 DNS resolve 결과 검사까지 확장했다. | hostname 문자열 검사만으로는 내부 IP로 resolve되는 도메인을 막을 수 없다. |

## 알려진 이슈 / 기술 부채

- (해소) Phase 1 수용 기준 — 로그인/리다이렉트/로그아웃/`GET /api/me` — 사용자가 실제 동작 확인 완료. `supabase db push` 및 대시보드 가입 차단/계정 생성도 사용자 측에서 반영된 것으로 확인.
- Phase 2 실제 계정 API E2E 확인 완료: Supabase password login → `GET /api/me`, 카테고리 생성/목록 count, 수동/미지정 북마크 등록, 정규화 중복 409(`existingId`), metadata title/favicon 백그라운드 보강, 검색/카테고리/미분류 필터, 카테고리 변경, 카테고리 삭제 시 미분류化, pagination 응답 shape를 `PORT=3101` 현 브랜치 API에서 확인했다. 테스트 데이터는 스크립트 종료 시 삭제했다.
- Phase 2 브라우저 UI 조작 확인 필요: 도구에 Playwright/Puppeteer가 없어 실제 클릭 기반 확인은 자동화하지 못했다. 웹 dev 서버는 `VITE_API_URL=http://localhost:3101` + port 3100에서 HTTP 200 렌더 확인 완료. 남은 항목: 중복 URL 토스트, 375px 모바일 레이아웃, 다크모드 토글, 인라인 카테고리 생성/무한 스크롤의 실제 브라우저 확인.
- dev 확인 중 기본 API 포트 3001이 이미 사용 중이며 Phase 2 라우트가 없는 이전 프로세스였다. 이후 검증은 충돌 없는 `PORT=3101 pnpm --filter @my-bookmark/api dev`로 수행했다.
- SSR 가드 공백: `_authed` 라우트의 `beforeLoad`는 클라이언트에서만 세션을 검사한다(docs/04-auth line 27 허용). `_authed` 하위에 민감 데이터를 SSR로 렌더하지 말 것 — 비인증 초기 HTML로 노출된다.
- `jwtVerify`에 `algorithms` 화이트리스트 미지정: jose v6의 JWKS 리졸버가 키의 `alg`에 검증을 바인딩하므로 현재 악용 불가. Supabase 키 타입 확정 후 defense-in-depth로 명시 고려.
- Vite production build가 client `index` chunk 500KB 초과 경고를 출력한다. 현재 Phase 2 검증은 통과했으며, 번들 예산/코드 스플리팅은 Phase 7 성능 작업에서 재점검한다.

## 배포 후 TODO

- iOS 실기기에서 홈 화면 설치 → 푸시 수신 확인 (HTTPS 필요, Phase 6 참조)
