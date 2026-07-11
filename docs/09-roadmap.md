# 09. 구현 로드맵

Phase 0 → 7 순서대로 진행한다. **한 세션에 한 Phase**를 권장한다 (컨텍스트 품질 유지).

## Phase 진행 규칙

1. 시작 전: `PROGRESS.md` + 이 문서의 해당 Phase + "참조 문서"를 읽는다.
2. 각 Phase의 수용 기준을 전부 만족하고 `pnpm typecheck && pnpm lint && pnpm test && pnpm build`가 통과해야 완료다.
3. 완료 시 `PROGRESS.md` 갱신 (체크박스, 결정 로그, 이슈).
4. 커밋은 작업 단위별로. Phase 완료 시점에 `feat: complete phase N — <요약>` 커밋이 마지막에 오도록.
5. 이전 Phase 산출물의 버그를 발견하면 고치고 PROGRESS.md에 기록한다 (별도 허락 불필요).

---

## Phase 0 — 모노레포 스캐폴딩

**목표**: 빈 저장소 → 도구 체인이 완비된 워크스페이스. 기능 없음.
**참조**: 01-architecture

작업:
- [ ] `git init`, `.gitignore` (node_modules, dist, .env, public/sw.js)
- [ ] `pnpm-workspace.yaml` (apps/*, packages/*), 루트 package.json 스크립트: `dev`(web+api 병렬), `typecheck`, `lint`, `test`, `build` — `pnpm -r --parallel` 활용
- [ ] `tsconfig.base.json` (strict, ES2023 target). 각 패키지가 extends
- [ ] Biome 설정 (`biome.json`) — lint+format, 루트 1개
- [ ] `apps/web`: **공식 CLI로 스캐폴딩** (`pnpm create @tanstack/start@latest`) 후 이 저장소 구조로 이식. Tailwind v4 설정. 스캐폴드가 만든 예제 라우트는 홈 placeholder로 정리
- [ ] `apps/api`: Express 5 + tsx(dev) + tsup(build). `/api/health` 엔드포인트, helmet, cors(WEB_ORIGIN), pino, 에러 미들웨어(03-api 포맷), zod env 검증(`lib/env.ts`)
- [ ] `packages/shared`, `packages/ai`: 빈 껍데기 + TS 소스 직접 export 설정 (01-architecture의 함정 참조). shared에 에러 코드 상수 정도만
- [ ] `.env.example` 작성 (01-architecture의 표 전체)
- [ ] Vitest 설정 (api, packages에) + 샘플 테스트 1개

수용 기준:
- [ ] `pnpm install && pnpm dev` → web(:3000) 렌더, `curl localhost:3001/api/health` → `{"ok":true}`
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 전부 통과
- [ ] api 프로덕션 빌드 실행 확인: `node apps/api/dist/index.js`가 health 응답 (tsup noExternal 검증)

---

## Phase 1 — DB + 인증

**목표**: 로그인해야만 쓸 수 있는 껍데기 앱.
**참조**: 02-database, 04-auth
**선행(사용자 수동)**: Supabase 프로젝트 생성, 가입 차단 설정, 계정 1개 생성, `.env` 채우기 — 절차는 04-auth. **에이전트는 이 값들이 준비됐는지 먼저 확인하고, 없으면 사용자에게 요청 후 중단.**

작업:
- [ ] supabase CLI 초기화, `0001_initial.sql` 마이그레이션 (02-database의 스키마+RLS 전체), `supabase db push`
- [ ] `packages/shared`: 도메인 zod 스키마 (Bookmark, Category, Reminder, 요청/응답 스키마)
- [ ] api: `lib/supabase.ts` (secret key admin client), `middleware/auth.ts` (JWKS Bearer 검증 — 04-auth 코드 개요), 보호 라우트 예시로 `GET /api/me` → `{ userId }`
- [ ] web: `lib/supabase.ts`, `/login` 화면(07-ui), `_authed` 가드 라우트, `lib/api-client.ts` (Bearer 첨부 + 401 refresh 재시도), 로그아웃
- [ ] auth 미들웨어 단위 테스트 (유효/만료/변조 토큰 — jose로 테스트 키쌍 생성해 mock)

수용 기준:
- [ ] 비로그인 → `/` 접근 시 `/login` redirect
- [ ] 로그인 성공 → 홈 진입, `GET /api/me`가 userId 반환. 로그아웃 동작
- [ ] 잘못된 비밀번호 에러 표시. Supabase 대시보드에서 가입 차단 확인됨
- [ ] 검증 루프 통과

---

## Phase 2 — 북마크 + 카테고리 CRUD

**목표**: 수동/미지정 모드의 완전한 북마크 관리. (AI는 다음 Phase)
**참조**: 03-api, 02-database, 07-ui

작업:
- [ ] api: bookmarks 라우트 전체 (POST — mode=manual/none만, ai는 501로 두거나 metadata만, GET 목록 keyset+검색+categoryId 필터, GET/:id, PATCH, DELETE), categories 라우트 전체(withCounts 포함), URL 정규화 유틸+테스트, 409 중복 처리
- [ ] api: `services/metadata.ts` (05-ai 명세 — fetch/파싱/SSRF 방지/폴백) + 백그라운드 실행 연결 + 테스트
- [ ] web: 홈 화면 전체 (07-ui — 카테고리 칩, 검색 debounce, 무한 스크롤 목록, BookmarkCard + 메뉴, 빈 상태), 추가 다이얼로그(3-모드 토글이되 AI 모드는 "다음 업데이트" 비활성 처리), 카테고리 관리(설정 섹션 2), 다크모드 토글
- [ ] 삭제/수정/카테고리 변경 플로우 + 토스트

수용 기준:
- [ ] URL 등록(수동/미지정) → 목록 반영, 잠시 후 title/favicon 자동 채워짐 (metadata 백그라운드)
- [ ] 같은 URL 재등록 → "이미 저장된 링크" 토스트
- [ ] 카테고리 생성/변경/삭제(소속 북마크 미분류化 확인), 칩 필터·미분류 필터·검색·무한 스크롤 동작
- [ ] 모바일 뷰포트(375px)에서 레이아웃 깨짐 없음, 다크모드 정상
- [ ] 검증 루프 통과

---

## Phase 3 — AI 카테고리 분류

**목표**: mode=ai 완성. 멀티 provider.
**참조**: 05-ai

작업:
- [ ] `packages/ai`: 타입/인터페이스/팩토리 + Gemini/Anthropic/OpenAI 구현 (구조화 출력, zod 파싱, 15s 타임아웃) + mock 기반 테스트
- [ ] api: `services/categorize.ts` 파이프라인 (05-ai 순서도 그대로 — 조건부 UPDATE, catch 종결, 카테고리 자동 생성 시 중복 재확인) + 테스트
- [ ] api: POST /api/bookmarks mode=ai 연결, `POST /api/bookmarks/:id/categorize` 재분류
- [ ] web: 추가 다이얼로그 AI 모드 활성화, pending 배지 + 조건부 폴링, failed 시 재분류 메뉴, 설정에 AI provider 표시

수용 기준:
- [ ] Gemini 키만 설정한 상태에서: 기술 블로그 URL 등록 → 수초 내 적절한 카테고리 자동 지정(기존 매칭 또는 신규 생성) 확인
- [ ] 설정에서 Anthropic/OpenAI로 바꿔도 동작 (키 있으면 실제 호출, 없으면 failed 처리 확인)
- [ ] AI 키 없이 mode=ai 등록해도 서버가 죽지 않고 failed 처리 → UI에서 재시도 가능
- [ ] 분류 진행 중 사용자가 수동 지정하면 AI 결과가 덮어쓰지 않음 (조건부 UPDATE 테스트로 검증)
- [ ] 검증 루프 통과

---

## Phase 4 — API Key + iOS 단축어

**목표**: 단축어에서 등록 가능.
**참조**: 03-api(레시피 포함), 04-auth

작업:
- [ ] api: keys 라우트(발급 1회 노출/목록/회수), API Key 검증 미들웨어(sha256, revoked, last_used 스로틀), bookmarks/categories 라우트에 apiKey 허용 적용, express-rate-limit(분당 60)
- [ ] web: 설정 API 키 섹션 (발급 다이얼로그 + 1회 표시 + 복사, 목록, 회수 확인)
- [ ] `docs/shortcuts-guide.md` 생성: 03-api의 레시피 A/B를 사용자용 가이드로 완성 (스크린샷 자리 표시 포함)
- [ ] 미들웨어 테스트 (유효 키/회수된 키/무효 키, 허용 라우트 범위)

수용 기준:
- [ ] `curl -X POST -H "X-API-Key: bm_…" …/api/bookmarks -d '{"url":"…","mode":"ai"}'` → 201 + AI 분류까지 동작
- [ ] 같은 키로 `/api/keys` 호출 → 401 (범위 제한 확인). 회수된 키 → 401
- [ ] 웹에서 키 발급→복사→회수 전 과정 동작. 키 원문이 어떤 로그/응답에도 재노출되지 않음
- [ ] 검증 루프 통과

---

## Phase 5 — PWA

**목표**: 설치 가능한 앱 + 오프라인 읽기.
**참조**: 06-pwa-push (SW 빌드 함정 필독), 08-performance (캐시 전략)

작업:
- [ ] manifest.webmanifest + 아이콘 3종 생성(단순 도형 placeholder), `__root.tsx` head 연결 (apple-touch-icon 포함)
- [ ] `src/sw/sw.ts` (push 핸들러 자리 포함 골격 + 런타임 캐시) + esbuild 별도 빌드 스텝(dev watch/build) + 수동 등록 코드
- [ ] 정적 자산 캐시 헤더 확인/설정 (`sw.js`는 no-cache)

수용 기준:
- [ ] 프로덕션 빌드에서 Chrome "앱 설치" 가능 (DevTools Application 탭에서 manifest/SW 정상)
- [ ] 목록을 한 번 본 뒤 오프라인 전환(DevTools) → 홈에서 마지막 북마크 목록 읽기 가능
- [ ] `POST /api/*`가 SW에 캐시되지 않음을 확인
- [ ] Lighthouse에 installable 경고 없음
- [ ] 검증 루프 통과

---

## Phase 6 — Web Push + 리마인더

**목표**: 리마인더 생성 → 정시에 푸시 수신.
**참조**: 06-pwa-push

작업:
- [ ] VAPID 키 생성 절차 문서화 + env 반영
- [ ] api: push 라우트(구독 upsert/해지/test), `services/push-sender.ts` (410 정리 포함), reminders 라우트, `services/reminder-cron.ts` (조건부 클레임 — 06 순서도 그대로), graceful shutdown
- [ ] web: `lib/push.ts` 구독 플로우(사용자 제스처, iOS 미설치 안내), 설정 알림 섹션(토글+테스트 버튼), 리마인더 페이지 + 카드 메뉴의 리마인더 설정 다이얼로그, 알림 꺼짐 배너
- [ ] sw.ts push/notificationclick 완성
- [ ] cron 클레임 로직 테스트 (중복 발송 방지)

수용 기준:
- [ ] 데스크톱 Chrome: 알림 켜기 → 테스트 알림 수신. 리마인더를 2분 뒤로 설정 → 정시(±1분) 알림 수신 → 클릭 시 북마크 URL 열림
- [ ] 리마인더 발송 후 status=sent, 목록에서 사라짐. 취소한 리마인더는 발송 안 됨
- [ ] 구독 해지 후 테스트 발송 → failed 카운트, 410 구독 자동 삭제 확인 (또는 테스트로 검증)
- [ ] iOS 실기기 확인 항목은 "배포 후 TODO"로 PROGRESS.md에 기록
- [ ] 검증 루프 통과

---

## Phase 7 — 성능 + Docker + 마무리

**목표**: 배포 가능한 상태. 성능 목표 달성.
**참조**: 08-performance, 01-architecture(Docker)

작업:
- [ ] 시드 스크립트 (북마크 1,000개) → TanStack Virtual 적용 및 스크롤 검증
- [ ] Lighthouse 실행 → 90 미달 항목 수정, 결과 기록
- [ ] 번들 점검 (150KB gzip 예산), preload="intent" 적용 확인
- [ ] Dockerfile 2개 + docker-compose.yml + 헬스체크, `docker compose up`으로 전체 기동
- [ ] `docs/deploy.md`: 배포 절차(env, VAPID, Supabase 설정 요약, HTTPS/Caddy 안내, iOS 푸시 확인 체크리스트)
- [ ] 전체 회귀: Phase 1~6 수용 기준 재확인 (verify-app 스킬)

수용 기준:
- [ ] `docker compose up` → 전 기능 동작 (로그인/등록/AI/단축어/푸시)
- [ ] Lighthouse Performance ≥ 90 (모바일), 수치 PROGRESS.md 기록
- [ ] 1,000개 북마크에서 스크롤/검색 쾌적
- [ ] 검증 루프 통과

---

## Phase 8+ (백로그 — 지금 하지 않음)

반복 리마인더(rrule), 북마크 가져오기/내보내기, 전문 검색(FTS), 태그, 브라우저 확장, 읽기 모드 아카이브, 알림 히스토리.
