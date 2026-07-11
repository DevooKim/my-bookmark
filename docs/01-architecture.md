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
├── pnpm-workspace.yaml
├── package.json              # 루트: dev/typecheck/lint/test/build 스크립트 (pnpm -r)
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

2026-07 기준: TanStack Start v1(1.168+), React 19, Vite(Start에 포함된 버전 사용), Express 5, Tailwind v4, Node 22 LTS.

**정확한 버전과 API는 스캐폴딩 시점의 공식 도구가 결정한다.** TanStack Start는 공식 CLI(`pnpm create @tanstack/start@latest`) 또는 공식 examples에서 시작하고, 이 문서와 스캐폴드가 충돌하면 스캐폴드(현행 API)를 따르되 구조(라우트 경로, 디렉토리 역할)는 이 문서를 따른다.

## 환경변수 (.env.example의 원본 명세)

### apps/api

| 변수 | 설명 |
|---|---|
| `PORT` | 기본 3001 |
| `WEB_ORIGIN` | CORS 허용 origin (예: `http://localhost:3000`) |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SECRET_KEY` | secret key (`sb_secret_…`, 구 service_role). 서버 전용 |
| `AI_SETTINGS_ENCRYPTION_KEY` | 설정 화면에서 저장한 AI API 키를 암호화하는 32바이트 base64 키. `openssl rand -base64 32`로 생성. 서버 전용이며 교체 시 기존 키 복호화 불가 |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys`로 생성 |
| `VAPID_SUBJECT` | `mailto:sammy.kim@goorm.io` 형식 |
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

- `apps/api`: node:22-alpine 멀티스테이지 (pnpm fetch → build → 실행 스테이지엔 dist만)
- `apps/web`: TanStack Start 빌드 산출물의 Node 서버 실행 (SSR)
- Supabase는 클라우드 사용 — 로컬 컨테이너 불필요. (로컬 개발 시 `supabase start`는 선택사항)
- 리버스 프록시/HTTPS(Caddy)는 배포처 확정 후 docker-compose 오버라이드로 추가. **푸시와 PWA 설치는 HTTPS 필수**이므로 배포 시 반드시 필요하다는 점만 기록해둔다.

## 횡단 관심사

- **CORS**: api는 `WEB_ORIGIN`만 허용. 단축어(API Key)는 CORS 무관(브라우저 아님).
- **보안 헤더**: helmet 기본 적용.
- **레이트 리밋**: `express-rate-limit` — API Key 인증 엔드포인트에 분당 60회 (무차별 대입 완화).
- **로깅**: pino(JSON). 요청 로그 + 에러 스택. AI 응답 원문은 debug 레벨.
- **graceful shutdown**: SIGTERM 시 cron 중지 → 서버 close.
