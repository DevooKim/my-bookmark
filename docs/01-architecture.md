# 01. 아키텍처

## 전체 그림

```
┌─────────────┐     ┌──────────────┐
│ 브라우저/PWA │     │ iOS 단축어    │
│ (apps/web)  │     │              │
└──────┬──────┘     └──────┬───────┘
       │ Bearer JWT         │ X-API-Key
       │ (Supabase 세션)     │
       ▼                    ▼
┌──────────────────────────────────┐        ┌─────────────────┐
│  Express API (apps/api)          │───────▶│ Supabase        │
│  - REST /api/*                   │ secret │  - Postgres+RLS │
│  - JWT 검증(JWKS) / API Key 검증  │  key   │  - Auth (JWKS)  │
│  - 메타데이터 fetch + AI 분류      │        └─────────────────┘
│  - node-cron 리마인더 스케줄러     │
│  - web-push 발송                  │───▶ 푸시 서비스(APNs/FCM/Mozilla)
└──────────────────────────────────┘              │
                                                  ▼
                                        Service Worker → OS 알림
```

- **웹앱은 supabase-js를 인증(로그인/세션/토큰 갱신)에만 사용**한다. 데이터 CRUD는 전부 Express API를 호출한다.
- Express는 Supabase **secret key**(구 service_role)로 DB에 접근한다. RLS는 심층 방어로 활성화해두지만 Express 경로에서는 bypass된다.
- 인증 없는 DB 직접 접근 경로는 존재하지 않는다 (publishable key로는 RLS 때문에 아무것도 못 읽음).

## 모노레포 구조

```
my-bookmark/
├── bun.lock
├── bunfig.toml               # Nitro npm alias 호환을 위한 hoisted linker
├── package.json              # Bun workspaces + 루트 dev/typecheck/lint/test/build
├── biome.json
├── tsconfig.base.json
├── docker-compose.yml
├── .env.example
├── apps/
│   ├── web/                  # TanStack Start
│   │   ├── src/
│   │   │   ├── routes/       # 파일 기반 라우팅 (__root.tsx, login.tsx, _authed/…)
│   │   │   ├── components/
│   │   │   ├── lib/          # api-client.ts, supabase.ts, push.ts
│   │   │   └── sw/sw.ts      # 서비스 워커 소스 (별도 esbuild로 번들 → public/sw.js)
│   │   ├── public/           # manifest.webmanifest, 아이콘
│   │   └── vite.config.ts
│   └── api/                  # Express 5
│       └── src/
│           ├── index.ts      # 부트스트랩 (helmet, cors, 라우터, 에러 미들웨어, cron 시작)
│           ├── middleware/    # auth.ts (JWT/API Key), error.ts, rate-limit.ts
│           ├── routes/       # bookmarks.ts, categories.ts, reminders.ts, push.ts, keys.ts, health.ts
│           ├── services/     # metadata.ts, categorize.ts, push-sender.ts, reminder-cron.ts
│           └── lib/          # supabase.ts (admin client), env.ts (zod로 env 검증)
├── packages/
│   ├── shared/               # zod 스키마 + API 타입 + 상수. 빌드 없이 TS 소스 export
│   └── ai/                   # AiProvider 인터페이스 + gemini/anthropic/openai 구현
├── supabase/
│   └── migrations/           # 0001_initial.sql …  (supabase CLI)
└── docs/
```

### 워크스페이스 패키지 규칙 (함정 주의)

`packages/shared`, `packages/ai`는 **빌드 스텝 없이** `"exports": { ".": "./src/index.ts" }`로 TS 소스를 직접 내보낸다.

- apps/web: Vite가 TS를 그대로 처리 → 문제 없음.
- apps/api dev: `tsx watch`가 workspace TS를 그대로 처리 → 문제 없음.
- apps/api **프로덕션 빌드**: tsup 설정에서 `noExternal: [/^@my-bookmark\//]`로 workspace 패키지를 번들에 포함해야 한다. 빠뜨리면 런타임에서 TS 파일을 require하다 죽는다.

패키지 네이밍: `@my-bookmark/shared`, `@my-bookmark/ai`, `@my-bookmark/web`, `@my-bookmark/api`.

## 버전 정책

2026-07 기준: TanStack Start v1(1.168+), React 19, Vite(Start에 포함된 버전 사용), Express 5, Tailwind v4, TypeScript 7.0.2, Node 24 LTS, Bun 1.3+.

**정확한 버전과 API는 스캐폴딩 시점의 공식 도구가 결정한다.** TanStack Start는 공식 CLI(`bun create @tanstack/start`) 또는 공식 examples에서 시작하고, 이 문서와 스캐폴드가 충돌하면 스캐폴드(현행 API)를 따르되 구조(라우트 경로, 디렉토리 역할)는 이 문서를 따른다.

## 환경변수 (.env.example의 원본 명세)

### apps/api

| 변수 | 설명 |
|---|---|
| `PORT` | 기본 3001 |
| `WEB_ORIGIN` | CORS 허용 origin (예: `http://localhost:3000`) |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SECRET_KEY` | secret key (`sb_secret_…`, 구 service_role). 서버 전용 |
| `OPEN_ROUTER_API_KEY` | OpenRouter API 키(https://openrouter.ai/keys). AI 분류는 preset `@preset/my-bookmark` 단일 호출로 동작하며, 모델 선택·폴백·파라미터는 openrouter.ai의 preset 설정이 담당한다(05-ai 참조). 미설정 시 AI 비활성 모드로 기동 |
| `OPEN_ROUTER_MANAGEMENT_KEY` | OpenRouter management 키(선택). 설정 시 `GET /api/ai/analytics`가 Analytics API(`/analytics/query`)를 프록시해 대시보드에 모델별·일별 비용/토큰 집계 카드를 표시한다. 미설정 시 해당 카드만 생략(`configured:false`) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys`로 생성 |
| `VAPID_SUBJECT` | `mailto:{email}` 형식 |
| `TRUST_PROXY` | 선택. 리버스 프록시 뒤에서 hop 수(예: `1`) — express `trust proxy` 설정. 미설정 시 미적용 |

### apps/web (클라이언트 노출 — 비밀값 금지)

| 변수 | 설명 |
|---|---|
| `VITE_SUPABASE_URL` | 위와 동일 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable key (`sb_publishable_…`, 구 anon) |
| `VITE_API_URL` | Express 주소 (dev: `http://localhost:3001`) |
| `VITE_VAPID_PUBLIC_KEY` | 푸시 구독용 공개키 (공개돼도 안전) |

api 부팅 시 `lib/env.ts`에서 zod로 전체 env를 검증하고, 누락 시 명확한 메시지로 즉시 종료한다.

## Docker 구성 (Phase 7)

- 빌드 단계: Bun 1.3.14로 `bun.lock` 기반 의존성 설치와 workspace build 수행.
- `apps/api`: node:24-alpine 실행 스테이지에서 프로덕션 의존성과 dist 번들 실행.
- `apps/web`: node:24-alpine에서 TanStack Start Node 서버 산출물 실행 (Compose/자체 호스팅 대안).
- Supabase는 클라우드 사용 — 로컬 컨테이너 불필요. (로컬 개발 시 `supabase start`는 선택사항)
- 기본 web 배포는 Vercel이며 `apps/web/vercel.json`에서 Bun 1.x Runtime Beta를 사용한다. API는 Node 24 Docker로 별도 배포한다.
- 자체 호스팅 시 리버스 프록시/HTTPS(Caddy)를 docker-compose 앞에 둔다. **푸시와 PWA 설치는 HTTPS 필수**다.

## 횡단 관심사

- **CORS**: api는 `WEB_ORIGIN`만 허용. 단축어(API Key)는 CORS 무관(브라우저 아님).
- **보안 헤더**: helmet 기본 적용.
- **레이트 리밋**: `express-rate-limit` — API Key 인증 엔드포인트에 분당 60회 (무차별 대입 완화).
- **로깅**: pino(JSON). 요청 로그 + 에러 스택. AI 응답 원문은 debug 레벨.
- **graceful shutdown**: SIGTERM 시 cron 중지 → 서버 close.
