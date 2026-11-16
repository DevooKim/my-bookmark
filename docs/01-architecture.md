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
│  Go API (apps/api)               │───────▶│ Supabase        │
│  - REST /api/*                   │ secret │  - Postgres+RLS │
│  - JWT 검증(JWKS) / API Key 검증  │  key   │  - Auth (JWKS)  │
│  - 메타데이터 fetch + AI 분류      │        └─────────────────┘
│  - 리마인더 스케줄러              │
│  - Web Push 발송                 │───▶ 푸시 서비스(APNs/FCM/Mozilla)
└──────────────────────────────────┘              │
                                                  ▼
                                        Service Worker → OS 알림
```

- **웹앱은 supabase-js를 인증(로그인/세션/토큰 갱신)에만 사용**한다. 데이터 CRUD는 전부 Go API를 호출한다.
- Go API는 Supabase **secret key**로 DB에 접근한다. RLS는 심층 방어로 활성화해두지만 API 경로에서는 bypass된다.
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
│   └── api/                  # Go API 서버
│       ├── cmd/server/       # 서버 부트스트랩, 환경 설정, 라우팅
│       ├── internal/         # 인증·MCP·북마크·AI·이미지·푸시·리마인더
│       ├── scripts/          # 별도 실행하는 TypeScript 운영 도구
│       ├── go.mod, go.sum
│       └── Dockerfile        # Go 빌드 및 libvips 실행 이미지
├── packages/
│   ├── shared/               # zod 스키마 + API 타입 + 상수. 빌드 없이 TS 소스 export
│   └── ai/                   # TypeScript 관리 도구용 OpenRouter 구현
├── supabase/
│   └── migrations/           # 0001_initial.sql …  (supabase CLI)
└── docs/
```

### 워크스페이스 패키지 규칙

`packages/shared`, `packages/ai`는 **빌드 스텝 없이** TypeScript 소스를 직접 내보낸다. 웹과 별도 실행하는 TypeScript 관리 도구가 사용하며, Go API 실행 파일에는 포함되지 않는다.

패키지 네이밍: `@my-bookmark/shared`, `@my-bookmark/ai`, `@my-bookmark/web`, `@my-bookmark/api`.

## 버전 정책

서버: Go 1.27 및 libvips. 웹: TanStack Start v1, React 19, Tailwind v4, TypeScript 7.0.2, Node 24 LTS, Bun 1.4.

**정확한 버전과 API는 스캐폴딩 시점의 공식 도구가 결정한다.** TanStack Start는 공식 CLI(`bun create @tanstack/start`) 또는 공식 examples에서 시작하고, 이 문서와 스캐폴드가 충돌하면 스캐폴드(현행 API)를 따르되 구조(라우트 경로, 디렉토리 역할)는 이 문서를 따른다.

## 환경변수 (.env.example의 원본 명세)

### apps/api

| 변수 | 설명 |
|---|---|
| `PORT` | 기본 3001 |
| `WEB_ORIGIN` | CORS 허용 origin (예: `http://localhost:3000`) |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SECRET_KEY` | secret key (`sb_secret_…`, 구 service_role). 서버 전용 |
| `OPEN_ROUTER_API_KEY` | OpenRouter API 키(https://openrouter.ai/keys). AI 분류는 요청의 `models` 배열(아래 `OPEN_ROUTER_MODELS`)로 폴백하며, provider 제한은 요청이 직접 명시한다(05-ai 참조). 미설정 시 AI 비활성 모드로 기동 |
| `OPEN_ROUTER_MODELS` | 분류 모델과 폴백 순서(선택, 쉼표 구분 `vendor/model`, zod 검증). 기본값 `google/gemini-3.5-flash-lite,openai/gpt-6-luna`. 빈 값은 미설정으로 취급 |
| `OPEN_ROUTER_MANAGEMENT_KEY` | OpenRouter management 키(선택). 설정 시 `GET /api/ai/analytics`가 Analytics API(`/analytics/query`)를 프록시해 대시보드에 모델별·일별 비용/토큰 집계 카드를 표시한다. 미설정 시 해당 카드만 생략(`configured:false`) |
| `NAVER_SEARCH_CLIENT_ID` / `NAVER_SEARCH_CLIENT_SECRET` | 선택. NAVER API HUB 지역 검색 Client ID/Secret(서버 전용). 국내 장소 좌표 조회에 사용하며 미설정 시 조회를 건너뛰고 기동 시 경고 1회 |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys`로 생성 |
| `VAPID_SUBJECT` | `mailto:{email}` 형식 |
| `TRUST_PROXY` | 선택. 리버스 프록시 뒤에서 신뢰할 hop 수(예: `1`); 미설정 시 전달 헤더를 신뢰하지 않음 |

### apps/web (클라이언트 노출 — 비밀값 금지)

| 변수 | 설명 |
|---|---|
| `VITE_SUPABASE_URL` | 위와 동일 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable key (`sb_publishable_…`, 구 anon) |
| `VITE_API_URL` | 선택적 API origin (경로 `/api` 제외). 비우면 dev는 `http://localhost:3001`, production은 같은 origin |
| `VITE_VAPID_PUBLIC_KEY` | 푸시 구독용 공개키 (공개돼도 안전) |
| `VITE_NAVER_MAP_CLIENT_ID` | 네이버 클라우드 플랫폼 Maps 인증 키 ID (`/map` 지도 SDK용, 브라우저 노출 가능). 미설정이면 지도 대신 안내 문구 |

API는 기동 시 서버 환경을 검증하고 필수 설정 오류를 명확히 보고한 뒤 종료한다.

## Docker 구성 (Phase 7)

- `apps/api`: Go 1.27 Alpine 빌드 스테이지에서 Go 실행 파일을 생성하고, Alpine 실행 이미지에 libvips와 CA 인증서를 포함한다.
- `apps/web`: 빌드한 정적 SPA만 `docker.io/library/caddy:2-alpine`에서 제공한다. 기존 운영 Caddy 뒤의 별도 정적 서버 프로세스다.
- Supabase는 클라우드 사용 — 로컬 컨테이너 불필요. (로컬 개발 시 `supabase start`는 선택사항)
- web은 기존 운영 Caddy가 Compose web을 프록시하는 방식으로 제공한다. `/api/*`는 기존 도메인별 API 라우팅을 유지한다.
- 자체 호스팅 시 리버스 프록시/HTTPS(Caddy)를 docker-compose 앞에 둔다. **푸시와 PWA 설치는 HTTPS 필수**다.

## 횡단 관심사

- **CORS**: api는 `WEB_ORIGIN`만 허용. 단축어(API Key)는 CORS 무관(브라우저 아님).
- **보안 헤더**: API가 보안 응답 헤더를 설정한다.
- **레이트 리밋**: API Key 인증 대상 경로에 분당 60회/IP 제한을 적용한다.
- **로깅**: 서버 오류와 외부 연동 오류를 기록하며 인증 정보는 출력하지 않는다.
- **운영 알림**: 같은 Compose의 Uptime Kuma가 Caddy 경유 가용성을 확인하고, API는 Discord Webhook으로 cron·Push·AI·서버 오류와 IP별 비정상 접근 임계치를 알린다. 알림 실패는 원래 작업을 실패시키지 않는다.
- **접근 감지**: Caddy 뒤 `TRUST_PROXY=1`의 실제 IP를 기준으로 인증 실패(1분 5회), API 경로 탐색, parser/413, 429를 메모리에서 집계한다. 자동 차단은 하지 않는다.
- **graceful shutdown**: SIGTERM 시 cron 중지 → 서버 close.
