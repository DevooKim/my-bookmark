# CLAUDE.md — my-bookmark 작업 지침

개인용(1인) 북마크 관리 웹서비스. AI 자동 카테고리 분류, PWA + Web Push 리마인더, iOS 단축어 등록 API를 제공한다.

이 문서는 **모든 작업 세션의 출발점**이다. 설계 결정은 이미 `docs/`에 확정되어 있다 — 아키텍처를 새로 고민하지 말고 문서를 따르라.

## 작업 프로토콜 (필수)

1. **시작**: `PROGRESS.md`를 읽고 현재 Phase와 미완료 항목을 파악한다.
2. **구현 전**: `docs/09-roadmap.md`에서 해당 Phase를 읽고, Phase에 명시된 참조 문서를 반드시 읽는다. 문서를 읽지 않고 구현을 시작하지 않는다.
3. **구현 중**: 아래 "구현 원칙"을 따른다.
4. **완료 전**: 검증 루프(아래)를 통과할 때까지 반복한다. 실패 상태로 완료를 선언하지 않는다.
5. **마무리**: `PROGRESS.md`를 갱신한다 — 완료 항목 체크, 스펙에서 벗어난 결정과 그 이유, 남은 이슈.

스킬 사용: `/implement-phase <N>` (Phase 구현), `/verify-app` (전체 검증), `/review-phase <N>` (수용 기준 대비 리뷰).

## 구현 원칙 — Sonnet/Opus 세션을 위한 핵심 지침

이 프로젝트의 문서는 구현 모델이 아키텍처 판단 없이 코딩에 집중할 수 있도록 작성되었다. 다음을 지키면 상위 모델 수준의 결과가 나온다:

1. **라이브러리 API를 기억에 의존해 쓰지 말 것.** 특히 TanStack Start는 v1 이후에도 빠르게 변한다(2026-07 기준 v1.168+). 스캐폴딩은 공식 CLI/예제(`bun create @tanstack/start` 또는 공식 examples)에서 시작하고, API 시그니처가 불확실하면 `node_modules`의 타입 정의나 공식 문서를 확인한 뒤 사용한다. 추측으로 작성한 코드가 타입 에러를 내면, 억지로 우회(`any`, `@ts-ignore`)하지 말고 올바른 API를 찾는다.
2. **경계에서 zod 검증.** 모든 HTTP 요청 본문/쿼리, AI 응답, 외부 페이지 메타데이터는 `packages/shared`의 zod 스키마로 파싱한다. 타입 단언(`as`)으로 대체하지 않는다.
3. **스펙이 모호하면**: (a) `docs/`에서 관련 원칙을 찾고, (b) 없으면 가장 단순한 해석을 선택하고 `PROGRESS.md`의 결정 로그에 기록한다. 아키텍처 수준의 변경(테이블 추가, 인증 방식 변경, 의존성 교체)은 임의로 하지 말고 사용자에게 확인한다.
4. **에러를 삼키지 않는다.** 실패한 테스트를 skip 처리하거나, 빌드 에러를 설정 완화로 덮지 않는다. 원인을 고친다.
5. **범위를 지킨다.** 현재 Phase의 수용 기준에 없는 기능을 미리 만들지 않는다. "나중에 필요할 것 같은" 추상화를 추가하지 않는다.
6. **알려진 함정**(상세는 각 문서):
   - `vite-plugin-pwa`는 TanStack Start 프로덕션 빌드와 호환 문제가 있다. 서비스 워커는 별도 esbuild 스텝으로 빌드한다 → `docs/06-pwa-push.md`
   - Supabase 신규 프로젝트는 비대칭 JWT. Express에서 `jose` + JWKS로 검증한다(레거시 HS256 아님) → `docs/04-auth.md`
   - `packages/*`는 빌드 없이 TS 소스를 직접 export한다. api의 프로덕션 빌드는 tsup이 workspace 의존성을 번들에 포함(`noExternal`)해야 한다 → `docs/01-architecture.md`
   - iOS Web Push는 홈 화면에 설치된 PWA + 사용자 제스처 내 권한 요청만 동작한다 → `docs/06-pwa-push.md`
   - Express 5는 async 핸들러의 rejection을 자동으로 에러 미들웨어에 전달한다. `express-async-handler` 같은 래퍼를 추가하지 않는다.

## 기술 스택 (확정 — 변경 시 사용자 확인 필요)

| 영역 | 선택 |
|---|---|
| 패키지 매니저 | Bun workspaces (모노레포) |
| 프론트엔드 | TanStack Start v1 (React 19, Vite), TanStack Query/Form/Virtual |
| 스타일 | Tailwind CSS v4, shadcn/ui 스타일 컴포넌트, lucide-react, sonner |
| 백엔드 | Express 5 (TypeScript, tsx dev / tsup build) |
| DB/인증 | Supabase (Postgres + Auth, 클라우드), supabase CLI 마이그레이션 |
| AI | 자체 provider 인터페이스 — Gemini(기본)/Anthropic/OpenAI |
| 푸시 | web-push (VAPID), node-cron 스케줄러 |
| 품질 도구 | Biome (lint+format), Vitest, TypeScript 7.0.2 strict |
| 배포 | web: Vercel Bun Runtime Beta, api: Docker (Node LTS) |
| Node | 24 LTS |

## 저장소 구조

```
apps/web        # TanStack Start 앱 (UI + PWA)
apps/api        # Express API 서버 (REST, AI 분류, 푸시, 스케줄러)
packages/shared # zod 스키마, API 타입, 상수 (TS 소스 직접 export)
packages/ai     # AI provider 인터페이스 + Gemini/Anthropic/OpenAI 구현
supabase/       # 마이그레이션 SQL (supabase CLI)
docs/           # 설계 명세 (이 문서들이 스펙의 원본)
```

데이터 흐름: **웹/단축어 → Express API → Supabase**. 웹은 supabase-js를 **인증에만** 사용하고, 데이터 CRUD는 전부 Express를 거친다(단일 API 표면). Express는 secret key로 DB에 접근한다.

## 명령어 (Phase 0 완료 후 유효)

```bash
bun install
bun run dev              # web(:3000) + api(:3001) 동시 실행
bun run typecheck        # 전 워크스페이스 타입체크
bun run lint             # Biome 검사 (--write로 자동수정)
bun run test             # Vitest
bun run build            # 전 워크스페이스 빌드
```

## 검증 루프 (모든 Phase 공통)

```bash
bun run typecheck && bun run lint && bun run test && bun run build
```

전부 통과 + 해당 Phase 수용 기준의 수동 확인 항목 완료 = Phase 완료. 하나라도 실패하면 원인을 고치고 다시 실행한다.

## 코딩 컨벤션

- TypeScript strict. `any`/`@ts-ignore` 금지(불가피하면 이유 주석과 함께 `PROGRESS.md`에 기록).
- named export 우선. 파일명은 kebab-case, React 컴포넌트 파일은 PascalCase 없이 kebab-case + named export.
- API 에러는 `{ error: { code, message } }` 포맷 통일 → `docs/03-api.md`.
- TanStack Query key 컨벤션: `['bookmarks', filters]`, `['categories']`, `['reminders']`, `['apiKeys']`. mutation 성공 시 관련 key invalidate.
- 주석은 코드로 표현 못 하는 제약/이유만. 한국어 UI 문자열, 코드 식별자는 영어.
- 커밋: Phase 내 작업 단위별로 작게. 메시지는 conventional commits (`feat:`, `fix:`, `chore:` ...).

## 환경변수

`.env.example`이 원본. 실제 값은 `.env`(git 제외). 목록과 설명은 `docs/01-architecture.md` 참조. **secret key, VAPID private key, AI API key는 절대 apps/web(클라이언트)에 노출 금지** — web에는 `VITE_` 접두사 변수만.
