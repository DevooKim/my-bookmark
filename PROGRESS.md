# PROGRESS — 구현 진행 로그

> 에이전트는 매 작업 세션 종료 시 이 파일을 갱신한다. 형식을 유지할 것.

## 현재 상태

- **현재 Phase**: AI 한국어 요약 제목·태그 기능 자동 검증 및 원격 마이그레이션 완료. 다음: 브라우저 수동 검증 + 배포처 확정
- **최종 갱신**: 2026-07-12 (AI 요약 제목·태그 Task 8 자동 검증 및 원격 마이그레이션)

## Phase 체크리스트

- [x] Phase 0 — 모노레포 스캐폴딩
- [x] Phase 1 — DB + 인증
- [x] Phase 2 — 북마크 + 카테고리 CRUD
- [x] Phase 3 — AI 카테고리 분류
- [x] Phase 4 — API Key + iOS 단축어
- [x] Phase 5 — PWA
- [x] Phase 6 — Web Push + 리마인더
- [x] Phase 7 — 성능 + Docker + 마무리
- [x] Phase 8 후속 — 설정 기반 AI provider/API 키 관리

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
| 2026-07-07 | OpenAI SDK는 Responses API의 `responses.parse` + `zodTextFormat`을 사용하고, Anthropic은 tool-use 강제 호출, Gemini는 `responseSchema`를 사용했다. 기본 모델명은 docs/05-ai의 지정값(`gemini-2.5-flash`, `claude-haiku-4-5`, `gpt-4o-mini`)을 유지했다. | 설치된 SDK 타입 정의 기준으로 구조화 출력 API를 확인해 구현했다. |
| 2026-07-07 | 선택 provider API key가 없으면 API 서버는 경고만 내고 기동하며, `mode=ai`/재분류 작업은 metadata 수집 후 `ai_status='failed'`로 종료한다. | docs/05-ai의 "AI 비활성 모드로 기동" 요구 준수. |
| 2026-07-07 | Phase 4에서 API Key 요청은 `express-rate-limit`로 `X-API-Key` 헤더가 있는 요청에만 분당 60회/IP 제한을 적용했다. | docs/03-api의 "API Key 인증 요청" 제한을 Bearer 웹앱 경로에는 적용하지 않기 위함. |
| 2026-07-07 | `/api`에 router-level auth를 쓰는 기존 구조 때문에 Bearer 전용 라우터가 API Key 허용 라우터를 가로막을 수 있어, 라우터별 auth middleware를 해당 path prefix(`/bookmarks`, `/categories`, `/keys`, `/ai`)에만 적용하고 회귀 테스트를 추가했다. | Express router middleware는 path가 맞지 않는 요청도 마운트 prefix가 맞으면 실행된다. API Key는 bookmarks/categories만 허용하면서 `/api/keys`는 Bearer 전용이어야 한다. |
| 2026-07-07 | Phase 4 리뷰 지적에 따라 pino HTTP 로그에서 `Authorization`/`X-API-Key` 헤더를 redaction하고, API Key 복사 실패 시 성공 토스트를 띄우지 않도록 Clipboard API 실패 처리를 추가했다. 또한 API Key rate limit의 429 응답을 공통 에러 포맷으로 맞추고, rate limit 적용 범위를 bookmarks/categories API Key 허용 경로로 제한했다. | API Key 원문은 발급 응답 1회 외 로그/응답에 재노출되면 안 되며, 복사 실패는 사용자가 직접 선택 복사할 수 있도록 명확히 알려야 한다. `/api/keys` 같은 Bearer 전용 라우트는 API Key 헤더가 있어도 수용 기준대로 401을 반환해야 한다. |
| 2026-07-10 | Phase 5 서비스 워커는 `vite-plugin-pwa` 없이 `src/sw/sw.ts`를 esbuild 별도 스텝으로 `public/sw.js`에 번들하고, 생성 산출물은 git/biome 대상에서 제외했다. | docs/06-pwa-push의 TanStack Start 호환성 함정을 그대로 따른다. SW 산출물은 build/dev에서 재생성되므로 소스(`src/sw/sw.ts`)만 추적한다. |
| 2026-07-10 | Lighthouse 13.4.0에서 PWA 카테고리/설치성 audit이 제거되어 `--only-categories=pwa`로 검증할 수 없었다. 대신 Chrome CDP로 프로덕션 서버에서 SW 등록(`/sw.js`), manifest/apple-touch-icon/theme-color 링크를 확인하고, manifest/아이콘/SW cache-control 헤더를 curl로 검증했다. | 현행 Lighthouse CLI의 기능 변경. DevTools Application 탭과 동등한 설치성 요소(manifest + maskable icon + SW 등록)는 직접 확인했다. |
| 2026-07-10 | Phase 5 리뷰 반영으로 로그아웃 시 `navigator.serviceWorker.controller?.postMessage({ type: "CLEAR_API_CACHE" })`와 `caches.delete("my-bookmark-api-v1")`를 함께 수행하도록 했다. SW도 `CLEAR_API_CACHE` message를 받아 동일 API cache를 삭제한다. | 인증 사용자별 오프라인 API 응답이 계정 전환/로그아웃 뒤 남으면 안 된다. controller가 없거나 message 전달이 지연돼도 page CacheStorage 직접 삭제로 정리되도록 이중 경로를 둔다. |
| 2026-07-10 | VAPID 키 생성 절차는 별도 사용자 문서 `docs/vapid-guide.md`로 추가했다. API는 VAPID 값이 없으면 기동은 허용하되 push 등록/테스트는 500으로 명확히 실패한다. | 로컬/테스트 환경에서 푸시 없이도 서버가 떠야 하며, 실제 발송 기능은 설정 누락을 숨기면 안 된다. |
| 2026-07-10 | 리마인더 cron은 조건부 `status='pending'` 업데이트로 먼저 `sent` 클레임한 뒤 발송한다. 구독이 0개이거나 전송 실패여도 클레임된 리마인더는 sent로 남긴다. | docs/06-pwa-push의 단순화된 순서도(재시도 큐 없음, 중복 발송 방지)를 그대로 따른다. |
| 2026-07-10 | Phase 6 리뷰 반영으로 `configureWebPush()` 결과를 서버 시작 시 보관해 VAPID 미설정/부분설정이면 reminder cron 자체를 시작하지 않도록 했다. | push 발송 불가능 상태에서 cron이 리마인더를 `sent`로 클레임하면 알림이 유실된다. |
| 2026-07-10 | `PATCH /api/reminders/:id`는 docs/03-api에 맞춰 `{ remindAt?, note? }` pending-only 수정으로 변경하고, 취소는 `DELETE`만 담당하게 했다. | 기존 구현은 `{ status: 'cancelled' }`만 받아 스펙과 달랐다. |
| 2026-07-10 | Phase 7: 홈 목록은 `@tanstack/react-virtual` `useWindowVirtualizer`를 항상 사용한다(100개 이하 조건 분기 없음). | docs/08의 "100개 초과 시 적용"은 구현 시점(Phase 7) 지시로 해석. 이중 렌더 경로는 스크롤 점프/테스트 표면만 늘린다. 1,000개에서 DOM 노드 ~14개 유지 확인. |
| 2026-07-10 | Phase 7 번들 예산: supabase-js(51KB gz)·다이얼로그·sonner Toaster를 dynamic import로 전환해 초기 라우트 JS를 /login 115KB gz로 낮췄다(예산 150KB). 인증된 `/` 콜드 로드는 150.4KB로 경계값. | supabase 청크가 root preload 그래프에 있어 /login에서 188KB였다. `/`는 api-client(zod)+query 공유 청크가 필요해 경계값 — SW cache-first라 재방문 비용 없음, 실제 콜드 진입 경로는 /login. |
| 2026-07-10 | Phase 7: api tsup에 `splitting: false` + `createRequire` banner를 추가했다. | 프로덕션 번들이 실행 불가였던 잠복 버그(Phase 3 이후 dist 미실행): (1) 번들된 AI SDK의 CJS dynamic require가 ESM에서 throw, (2) esm 청크 분할이 env.ts 평가를 dotenv side effect보다 먼저 실행. Docker 검증에서 발견. |
| 2026-07-10 | Phase 7: `styles.css`를 해시 없는 `/assets/app-styles.css`로 고정 emit하고 cache-control 3600으로 예외 처리했다. nitro `compressPublicAssets`(gzip+brotli)도 활성화. | linux Docker 빌드에서 SSR 패스가 자기 해시의 CSS를 링크하는데 public에는 클라이언트 패스 해시만 존재 → 404 → 무스타일 첫 페인트(CLS 0.47, Lighthouse 65). 고정 이름으로 두 패스가 같은 URL을 공유. 수정 후 Lighthouse 98. |
| 2026-07-10 | Phase 7: Gemini 기본 모델을 `gemini-flash-lite-latest`로 변경했다(docs/05-ai 표도 갱신). | `gemini-2.5-flash`가 generateContent 404(서비스 종료), `gemini-flash-latest`는 실호출이 15s 타임아웃/불안정. lite는 0.65s 안정 응답이며 단일 라벨 분류에 적합. docs/05의 "모델명은 바뀐다 — 현행으로 쓰고 기록" 지침 준수. |
| 2026-07-10 | Phase 7: VAPID 키가 `.env`에서 비어 있어 새로 생성해 채웠다(`VITE_VAPID_PUBLIC_KEY` 포함). | push_subscriptions가 0행이라 키 교체 부작용 없음. Docker 스택에서 cron 기동 조건(VAPID 완전 설정) 충족을 위해 필요. |
| 2026-07-11 | AI provider와 provider별 API 키의 원본을 서버 env에서 사용자별 `ai_settings` DB 행으로 변경하고, API 키는 `AI_SETTINGS_ENCRYPTION_KEY` 기반 AES-256-GCM 암호문만 저장한다. env fallback/자동 이관은 하지 않는다. | 사용자가 설정 화면에서 재시작 없이 provider와 키를 관리해야 하며, 키 원문은 DB·조회 응답·로그에 남기지 않아야 한다. 사용자 승인 설계(`docs/superpowers/specs/2026-07-11-ai-settings-design.md`) 준수. |
| 2026-07-11 | AI 모델은 동적 목록 대신 provider별 저비용/균형 2개씩 총 6개의 고정 카탈로그로 제공하고, 고성능 모델은 제외한다. 키 미설정 provider 모델도 선택 가능하되 `API 키 필요`를 표시하고 같은 폼에서 키 입력을 요구한다. | 사용자가 고정 추천 목록을 선택했고 고성능 모델 제외를 요청했다. 미설정 모델을 disabled 처리하면 해당 provider 키를 최초 등록할 진입점이 사라지므로 승인 설계의 disabled 표현을 사용 가능한 안내 옵션으로 정정했다. |
| 2026-07-11 | AI 키 저장 API/UI를 모델 선택에서 분리했다. provider별 카드가 키를 독립 관리하고, 모델 선택에는 키가 설정된 provider의 모델만 표시한다. | 결합 폼은 모델마다 키가 필요한 것처럼 보였다. `PUT /api/ai/keys/:provider`와 `PUT /api/ai/model`로 쓰기 경계를 분리해 키 저장이 활성 모델을 바꾸지 않게 했다. |
| 2026-07-10 | Phase 7: 시드 북마크는 `https://seed.my-bookmark.test/article/N` URL 마커를 사용하고 `--clean`으로만 삭제한다. `load-env`는 cwd `.env` 폴백을 추가했다. | 실데이터와 시드의 안전한 분리. dist 번들에서 URL 상대 경로가 저장소 루트를 벗어나 `node dist/index.js` 로컬 실행이 env를 못 읽던 문제 수정. |
| 2026-07-11 | 패키지 매니저를 Bun 1.3.14 workspaces로 교체하고 `bun.lock`을 단일 잠금 파일로 사용한다. Nitro nightly의 `nitro` npm alias 자기 import를 지원하기 위해 Bun linker는 hoisted로 고정한다. | Bun isolated linker에서는 alias가 앱 위치에만 생겨 Nitro 패키지 내부의 `import "nitro"`가 실패했다. hoisted linker가 pnpm과 동일하게 루트 alias를 제공하며 frozen install과 web build가 통과한다. |
| 2026-07-11 | Node 기반 경로는 Node.js 24 LTS로 고정하고, Vercel web Functions만 `bunVersion: "1.x"` Beta를 사용한다. Docker web은 `NITRO_PRESET=node-server`, Vercel 빌드는 환경 자동 감지 `preset: vercel`을 사용한다. | 사용자가 Node 24와 Vercel Bun Beta를 선택했다. 패키지 매니저, Docker 런타임, Vercel 함수 런타임을 명시적으로 분리해 각 배포 산출물의 런타임을 일치시킨다. |
| 2026-07-11 | 루트와 모든 workspace의 TypeScript를 정확히 7.0.2로 고정하고 web의 Node 타입 선언을 24 계열로 맞춘다. | `latest`와 `^6.0.2`가 섞여 workspace별 compiler가 갈릴 수 있었다. 단일 정확 버전으로 재현성을 확보하고 Node 24 런타임과 선언 타입을 일치시킨다. |

## 알려진 이슈 / 기술 부채

- (해소) Phase 1 수용 기준 — 로그인/리다이렉트/로그아웃/`GET /api/me` — 사용자가 실제 동작 확인 완료. `supabase db push` 및 대시보드 가입 차단/계정 생성도 사용자 측에서 반영된 것으로 확인.
- Phase 2 실제 계정 API E2E 확인 완료: Supabase password login → `GET /api/me`, 카테고리 생성/목록 count, 수동/미지정 북마크 등록, 정규화 중복 409(`existingId`), metadata title/favicon 백그라운드 보강, 검색/카테고리/미분류 필터, 카테고리 변경, 카테고리 삭제 시 미분류化, pagination 응답 shape를 `PORT=3101` 현 브랜치 API에서 확인했다. 테스트 데이터는 스크립트 종료 시 삭제했다.
- Phase 2 브라우저 UI 조작 확인 필요: 도구에 Playwright/Puppeteer가 없어 실제 클릭 기반 확인은 자동화하지 못했다. 웹 dev 서버는 `VITE_API_URL=http://localhost:3101` + port 3100에서 HTTP 200 렌더 확인 완료. 남은 항목: 중복 URL 토스트, 375px 모바일 레이아웃, 다크모드 토글, 인라인 카테고리 생성/무한 스크롤의 실제 브라우저 확인.
- dev 확인 중 기본 API 포트 3001이 이미 사용 중이며 Phase 2 라우트가 없는 이전 프로세스였다. 이후 검증은 충돌 없는 `PORT=3101 pnpm --filter @my-bookmark/api dev`로 수행했다.
- SSR 가드 공백: `_authed` 라우트의 `beforeLoad`는 클라이언트에서만 세션을 검사한다(docs/04-auth line 27 허용). `_authed` 하위에 민감 데이터를 SSR로 렌더하지 말 것 — 비인증 초기 HTML로 노출된다.
- `jwtVerify`에 `algorithms` 화이트리스트 미지정: jose v6의 JWKS 리졸버가 키의 `alg`에 검증을 바인딩하므로 현재 악용 불가. Supabase 키 타입 확정 후 defense-in-depth로 명시 고려.
- Vite production build가 client `index` chunk 500KB 초과 경고를 출력한다. 현재 Phase 3 검증은 통과했으며, 번들 예산/코드 스플리팅은 Phase 7 성능 작업에서 재점검한다.
- Phase 3 자동 검증 완료: provider 응답 zod 파싱(existing/new/none/실패), provider factory, provider별 SDK mock 경로(Gemini/Anthropic/OpenAI), 조건부 `ai_status='pending'` UPDATE(수동 지정 시 AI 결과 미덮어쓰기), 신규 카테고리 DB 재조회 기반 중복 재확인, 전체 검증 루프 통과.
- Phase 3 실제 계정 API E2E 확인 완료: 제공 계정으로 Supabase password login → `GET /api/ai`, 임시 카테고리 생성, `mode=ai` 북마크 등록 직후 `ai_status='pending'`, Gemini 실호출 후 `ai_status='done'`, 기존 개발 카테고리 매칭, title 존재, `POST /api/bookmarks/:id/categorize` 재분류 직후 `pending` 전이를 `PORT=3202` 현 브랜치 API에서 확인했다. 테스트 데이터는 스크립트 종료 시 삭제했다. 브라우저에서 pending/failed/재분류 메뉴 조작은 자동 확인하지 못했다.
- Phase 4 자동 검증 완료: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 통과. API Key 미들웨어(유효/무효/범위 제한), keys 라우트(발급 원문 1회 노출/목록 원문 미노출/회수), 앱 라우터 순서, API Key rate limit 범위/429 공통 에러 포맷, HTTP 로그 secret redaction, Clipboard API 복사 실패 처리 회귀 테스트 추가.
- Phase 4 실제 API E2E 확인 완료: 테스트용 API Key를 DB에 삽입 → `POST /api/bookmarks` with `X-API-Key` + `mode=ai`가 201 반환, `ai_status`가 `pending`에서 `done`으로 전이, 같은 키로 `/api/keys`는 401, 회수 후 `/api/categories`는 401을 `PORT=3301` 현 브랜치 API에서 확인했다. 테스트 데이터는 스크립트 종료 시 삭제했다.
- Phase 4 브라우저 UI 조작 확인 필요: 도구에 Playwright/Puppeteer가 없어 설정 화면에서 키 발급→복사→회수 클릭 플로우는 자동 확인하지 못했다. 타입/빌드와 API E2E는 통과했으며, 실제 브라우저에서 클립보드 권한/토스트/목록 갱신 확인이 필요하다.
- Phase 5 자동 검증 완료: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 통과. 서비스 워커 캐시 전략 테스트(정적 자산 cache-first, `GET /api/bookmarks`/`GET /api/categories` network-first + 오프라인 fallback, API mutation/기타 API network-only), 수동 등록 테스트, PWA 설정 테스트 추가.
- Phase 5 프로덕션 확인 완료: `PORT=3400 node apps/web/.output/server/index.mjs`로 manifest/SW/icon 응답을 확인했고 `manifest.webmanifest`/icons는 `cache-control: public, max-age=3600`, `sw.js`는 `cache-control: no-cache`임을 curl로 확인했다. Chrome headless CDP에서 `/login` 로드 후 `navigator.serviceWorker.getRegistrations()`가 `http://localhost:3400/sw.js`를 반환하고, manifest/apple-touch-icon/theme-color head 요소가 존재함을 확인했다. Lighthouse 13은 PWA audit을 제공하지 않아 별도 installable 경고 검사는 불가했다.
- Phase 5 리뷰 지적 반영 완료: 로그아웃 경로에서 SW API cache를 삭제하도록 `clearServiceWorkerApiCache` helper를 추가하고 `_authed/route.tsx`에서 `signOut()` 직후 호출한다. SW `CLEAR_API_CACHE` message handler와 직접 `CacheStorage.delete` 경로를 모두 테스트했다. 전체 검증 루프 재통과.
- Phase 6 자동 검증 완료: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 통과. push sender(web-push JSON payload, 410 만료 구독 삭제), reminder cron(조건부 클레임 후 발송, 경쟁 claim 실패 시 미발송), VAPID 공개키 변환 테스트 추가.
- Phase 6 구현 완료: `/api/push/status|subscriptions|unsubscribe|test`, `/api/reminders` 목록/생성/취소, 서버 listen 후 cron 시작 및 SIGTERM/SIGINT graceful stop, 설정 알림 섹션, 리마인더 페이지, 북마크 카드 리마인더 다이얼로그, 알림 꺼짐 배너를 추가했다.
- Phase 6 수동 확인 제한: 현재 환경에는 테스트 계정 자격 증명과 OS 알림 권한이 제공되지 않아 데스크톱 Chrome에서 실제 테스트 알림 수신 및 2분 뒤 리마인더 수신은 자동 확인하지 못했다. VAPID env 값 존재, 빌드/테스트, 서버·클라이언트 코드 경로는 검증했다. 실제 계정 로그인 후 설정 → 알림 켜기 → 테스트 알림/2분 리마인더 수신 확인 필요.
- Phase 6 리뷰 지적 반영 완료: VAPID 미설정 시 cron 미시작(클레임/알림 유실 방지), `POST /api/reminders` 과거/현재 `remindAt` 400, `PATCH /api/reminders/:id`의 `{ remindAt?, note? }` pending-only 수정 및 과거 `remindAt` 400/소유권 경계, `POST /api/push/subscriptions` 201 응답을 HTTP route 테스트로 보강했다. `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 재통과.

- Phase 7 자동 검증 완료: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 통과(24 파일 75 테스트). `docker compose up` → api/web 모두 healthy, `/api/health` ok.
- Phase 7 성능 수치 (2026-07-10, docker compose 프로덕션 스택 기준):
  - Lighthouse Performance (모바일, `/login`): **98** (FCP 1.8s, LCP 1.8s, TBT 0ms, CLS 0, SI 1.8s). 수정 전 65(CSS 404로 CLS 0.47 + 무압축 응답)였다.
  - 초기 라우트 JS(gzip): `/login` **115.2KB** ✓, 인증된 `/` 콜드 로드 150.4KB(경계값, 결정 로그 참조).
  - 1,000개 시드 스크롤: IntersectionObserver 무한 스크롤로 34페이지 전부 로드, 가상화로 DOM article 노드 11~23개 유지, 5초 연속 스크롤 중 평균 프레임 16.6ms(≈60fps), 50ms 초과 프레임 0. 검색(디바운스)·카테고리 칩·다크모드 정상.
  - `GET /api/bookmarks` 서버 responseTime p50 169ms / **p95 193ms — 목표(<150ms) 미달**. 단, 이 호스트에서 Supabase REST 왕복이 단독으로도 ~192ms(중앙값)라 앱 오버헤드는 ~0. 원인은 Supabase 프로젝트 리전 거리 — 배포 시 API를 DB 리전 가까이 두면 해소될 인프라 제약으로 기록.
- Phase 7 Docker E2E 완료 (compose 스택, 실계정): 로그인 토큰 발급 → `/api/me`, 카테고리 생성, 수동 북마크 등록(URL 정규화·utm 제거), 중복 409, PATCH 미분류화, 검색, keyset 커서, `mode=ai` 등록 → `pending` → **`done` + 카테고리 자동 생성**, API Key 발급→`X-API-Key` 등록 201→`/api/keys` 401→회수 후 401, 리마인더 생성/과거시각 400/취소 204, push status. 테스트 데이터는 모두 삭제.
- Phase 7 브라우저 회귀 (agent-browser, docker 스택): 로그인/로그아웃 리다이렉트, 홈 1,000개 목록, 설정(알림 토글·카테고리 관리·API 키·AI 분류·테마), 리마인더 페이지 + 알림 꺼짐 배너, SW 등록(`/sw.js` active), `sw.js` no-cache / manifest 3600 / assets immutable+gzip 헤더 확인.
- Phase 7 미완(사용자 확인 필요): 브라우저 알림 권한 → 테스트 알림/리마인더 실수신. CDP `Browser.grantPermissions/setPermission`이 Chrome 150(macOS)에서 페이지에 반영되지 않아 자동화 불가. 실브라우저에서 설정 → 알림 켜기 → 테스트 알림 → 2분 리마인더 수신을 확인해야 한다(Phase 6부터 이어진 항목).
- 참고: 자동화 중 macOS 디스플레이 절전 시 Chrome이 렌더링을 멈춰 rAF/IntersectionObserver가 정지한다. 무한 스크롤 검증은 `caffeinate` 후 통과 — 앱 버그 아님.
- Phase 7 리뷰 반영 완료 (2026-07-10):
  - HIGH: 리마인더 다이얼로그의 datetime-local 기본값/min이 `toISOString`(UTC) 기반이라 KST에서 9시간 과거로 표시되던 버그 수정 — 로컬 컴포넌트 기반 `toDatetimeLocalValue` helper(`lib/datetime.ts`) 도입, KST/EDT/UTC/자정 경계/round-trip 타임존 단위 테스트 5건 추가. 400 응답은 서버 메시지를 토스트에 반영.
  - HIGH: 고정 URL `/assets/app-styles.css`가 SW `/assets/*` cache-first에 걸려 배포 후 구 CSS가 영구 서빙되던 문제 수정 — 해당 경로만 `asset-network-first`(오프라인 시 캐시 폴백)로 분리하고, 고정 이름 CSS 분류/갱신/오프라인 폴백 테스트 추가. 해시 자산은 cache-first 유지.
  - LOW: `getSupabase()` dynamic import 실패 시 실패 promise를 캐시에서 버려 재시도 가능하게 하고, 로그인 폼은 에러 메시지 표시 + 버튼 복구, `_authed`는 무한 스피너 대신 기존 인증 에러 배너로 폴백.
  - LOW: `load-env`는 cwd `.env`를 URL 상대 경로보다 우선하도록 순서 교체(dist 실행 시 저장소 밖 경로가 우선되는 문제 제거).
  - LOW: `TRUST_PROXY` env 추가(`app.set("trust proxy", …)` — hop 수/boolean/서브넷 문자열 파싱 + 테스트). `.env.example`, docs/01-architecture, docs/deploy.md(Caddy 뒤 `TRUST_PROXY=1`)에 반영.
  - 재검증: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 통과(26 파일 84 테스트), `docker compose build && up` → api/web healthy, 서빙된 `sw.js`에 app-styles 분기 포함 확인.

- Phase 8 후속 AI 설정 자동 검증 완료: AES-256-GCM 무작위 IV/변조·오키 실패, env 검증, 사용자별 설정 기본값/암호화 저장/키 유지·삭제/provider 캐시 무효화, Bearer 전용 GET/PUT/DELETE API, 키 비노출, 분류 시 사용자별 provider 해석, 설정 UI 저장·삭제 테스트를 추가했다. 전체 검증 루프 통과(29 파일 104 테스트).
- Phase 8 Supabase/Docker/E2E 완료: `0002_ai_settings.sql`을 원격 DB에 push했고 MCP에서 migration 존재, `ai_settings` 컬럼·PK·FK·RLS 활성화를 확인했다. Docker api/web 재빌드 후 모두 healthy. 실계정 API에서 provider 선택+임시 키 저장→응답 비노출→삭제→Gemini 복원, 브라우저 설정에서 Anthropic 선택→password 키 저장→`설정됨`/입력 초기화→키 삭제→Gemini 복원을 확인했다. 임시 키는 삭제했다.
- AI 모델/연결 테스트 검증 완료: `0003_ai_model.sql` 원격 push 및 기존 OpenAI 행의 `gpt-4o-mini` backfill 확인. 고정 6-model 카탈로그/provider-model 검증, 선택 모델 provider 생성 전달, 세 SDK Models API mock, 연결 API, 그룹 모델 UI 테스트 포함 전체 113 테스트 통과. Docker 스택에서 실계정 상태가 OpenAI + GPT-4o mini + 암호화 키 설정으로 조회됐고, 실제 OpenAI Models API 연결 성공 및 브라우저의 “OpenAI 연결에 성공했어요” 토스트를 확인했다.
- AI 키/모델 UX 분리 검증 완료: provider 키 저장이 활성 모델을 보존하고 키가 있는 provider만 모델 선택 가능한 서비스/API 테스트, 결합 endpoint 제거, provider별 독립 입력 3개, 키 0개 빈 상태, 필터 모델/별도 저장 UI 테스트를 추가해 전체 117 테스트 통과. Docker 브라우저에서 Gemini/Anthropic/OpenAI 입력이 각각 표시되고, 저장된 OpenAI 키의 모델 2개만 목록에 표시되며 모델 저장과 OpenAI 연결 테스트 성공을 확인했다.
- AI 설정 레이아웃 개선: `사용 모델`을 `AI API 키`보다 위로 이동하고 독립 `rounded-xl` border 카드로 묶었다. DOM 순서/카드 스타일 회귀 테스트를 추가해 전체 118 테스트 통과.
- OpenAI 구조화 출력 수정: OpenAI SDK 6.45의 root object 요구에 맞춰 discriminated union을 `{ result: ... }` 객체로 감싸고 응답을 해제한다. 실제 `zodTextFormat` 변환 회귀 테스트를 추가했으며 전체 검증 루프를 통과했다.
- Bun/Node 24/Vercel 전환 검증 완료: Node 24.14.0 + Bun 1.3.14에서 frozen install, typecheck, lint, 전체 123 테스트, Node/Docker build 통과. `VERCEL=1` web build가 `[nitro:vercel] Using bun1.x runtime`과 `.vercel/output/functions`를 생성했다. Docker는 Bun install/build 후 Node 24 runtime에서 api/web 모두 healthy였고 `/api/health`는 `{"ok":true}`, `/manifest.webmanifest`는 200을 반환했다.
- TypeScript 7 전환 검증 완료: 다섯 package manifest가 모두 TypeScript 7.0.2를 사용하고 web은 Node 24 타입 선언을 사용한다. Node 24.14.0에서 frozen install, compiler version, typecheck, lint, 전체 124 테스트, build가 통과했다. Docker api/web 이미지를 재빌드해 모두 healthy, `/api/health` `{"ok":true}`, `/manifest.webmanifest` 200을 확인했다.
- AI 한국어 요약 제목·태그 Task 8 자동 검증 완료: 전체 검증 루프가 통과했다. 실제 Gemini가 `category.confidence`를 생략해 분류가 실패한 사례를 확인한 뒤, 사용되지 않는 confidence를 0으로 기본 처리하는 회귀 테스트를 추가했다. Anthropic/OpenAI의 새 응답 E2E는 아직 확인하지 않았다. Biome은 API seed script의 기존 info 1건과 web build의 기존 dynamic import 경고를 출력하지만 모두 exit 0이다.
- Supabase `0004_bookmark_tags.sql` 적용 완료: dry-run에서 해당 migration 1개만 확인 후 원격 push했다. CLI가 적용 뒤 pg-delta migration catalog cache의 인증서 파일 누락 경고를 출력했지만 push는 완료됐고, MCP에서 migration `0004 bookmark_tags`, `bookmarks.tags` ARRAY/NOT NULL/`'{}'::text[]`, `public.search_bookmarks` 7-인자 함수를 확인했다. `information_schema.routines`에서는 set-returning SQL 함수가 조회되지 않아 `pg_proc`로 존재와 시그니처를 재확인했다.
- AI 요약 제목·태그 브라우저/수동 UI 검증은 coordinator가 수행 예정이며 이번 작업에서는 실행하거나 완료로 주장하지 않는다. 남은 확인: 실제 AI 생성의 40자 이하 한국어 제목·3~5개 태그, 태그 클릭 검색, 편집 후 유지, 카테고리+태그 복합 필터.

## 배포 후 TODO

- iOS 실기기에서 홈 화면 설치 → 푸시 수신 확인 (HTTPS 필요, Phase 6 참조)
