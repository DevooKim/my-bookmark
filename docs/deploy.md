# 배포 가이드

web은 TanStack Start의 정적 SPA를 빌드해 Compose의 정적 Caddy에서 제공한다. 기존 운영 Caddy는 HTTPS와 기존 도메인별 web/API 프록시를 유지한다. Supabase는 클라우드를 사용한다.

## 0. 사전 준비 체크리스트

- [ ] Supabase 프로젝트 생성 완료, `ai_usage_events` 포함 최신 마이그레이션 반영(`bunx supabase db push`)
- [ ] Supabase Auth 설정: 이메일/비밀번호 로그인 활성, **신규 가입 차단**(개인용), 계정 1개 생성 — 상세는 `docs/04-auth.md`
- [ ] `.env` 작성 (아래 표)
- [ ] VAPID 키 생성 (아래)
- [ ] API를 실행할 Docker 호스트

## 1. 환경변수 (.env)

`.env.example`을 복사해 채운다. Compose가 같은 파일을 변수 치환(`${…}`)과 `env_file` 모두에 사용한다.

| 변수 | 용도 | 비고 |
|---|---|---|
| `PORT` | api 포트 | 기본 3001 |
| `WEB_ORIGIN` | api CORS 허용 origin | 배포 도메인 (예: `https://bm.example.com`) |
| `SUPABASE_URL` | Supabase 프로젝트 URL | |
| `SUPABASE_SECRET_KEY` | secret key (`sb_secret_…`) | **서버 전용. 절대 클라이언트 노출 금지** |
| `OPEN_ROUTER_API_KEY` | OpenRouter API 키 | https://openrouter.ai/keys 에서 발급. **서버 전용**. 미설정 시 AI 비활성 모드로 기동 |
| `OPEN_ROUTER_MODELS` | 분류 모델·폴백 순서(선택) | 쉼표 구분 `vendor/model`. 기본 `google/gemini-3.5-flash-lite,openai/gpt-6-luna` |
| `NAVER_SEARCH_CLIENT_ID` / `NAVER_SEARCH_CLIENT_SECRET` | NAVER API HUB 지역 검색 Client ID/Secret | 국내 장소 좌표 조회용. **서버 전용**. 미설정 시 좌표 조회를 건너뛰고 장소는 `pending`으로 남는다 |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push 서명키 | 아래 생성 절차 |
| `VAPID_SUBJECT` | `mailto:…` | |
| `TRUST_PROXY` | 리버스 프록시 hop 수 | Caddy 등 프록시 뒤에서는 `1` — 미설정 시 rate limit이 프록시 IP를 클라이언트로 본다 |
| `DISCORD_ALERT_WEBHOOK_URL` | 장애·비정상 접근 Discord Webhook | **서버 전용. 비공개 채널 Webhook 사용** |
| `ALERT_ENV` | Discord 메시지 환경명 | 기본 `home-production` |
| `VITE_SUPABASE_URL` | 웹 클라이언트용 | 빌드 시점에 번들에 포함 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable key (`sb_publishable_…`) | 공개 가능 |
| `VITE_API_URL` | 선택적 API origin (`/api` 제외) | 비우면 production은 동일 origin의 `/api/*`, dev는 `http://localhost:3001`. 기존 별도 API 도메인을 쓰는 경우 해당 HTTPS origin 지정 |
| `VITE_VAPID_PUBLIC_KEY` | 푸시 구독용 공개키 | `VAPID_PUBLIC_KEY`와 동일 값 |
| `VITE_NAVER_MAP_CLIENT_ID` | 네이버 클라우드 플랫폼 Maps 인증 키 ID (`/map` 지도용) | 빌드 시점에 번들에 포함. 공개 가능. 비어 있으면 `/map`은 지도 대신 안내 문구만 표시. 콘솔의 Web 서비스 URL에 배포 도메인을 등록해야 한다 |

주의: `VITE_*` 값은 **web 이미지 빌드 시점**에 번들로 구워진다. 값을 바꾸면 `docker compose build web`을 다시 해야 한다.

AI 분류는 OpenRouter 요청의 `models` 배열로 폴백한다 — 서버 env `OPEN_ROUTER_API_KEY`(키)와 선택적 `OPEN_ROUTER_MODELS`(모델·폴백 순서, 기본 `google/gemini-3.5-flash-lite,openai/gpt-6-luna`)로 설정한다(`docs/05-ai.md` 참조). 설정 화면에는 키 입력 UI가 없다.

## 2. VAPID 키 생성

```bash
bunx web-push generate-vapid-keys
```

출력된 Public/Private key를 `.env`의 `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VITE_VAPID_PUBLIC_KEY`에 넣는다. 상세는 `docs/vapid-guide.md`.

**키를 교체하면 기존 푸시 구독이 전부 무효화**된다(브라우저에서 알림을 다시 켜야 함).

## 3. 배포

### 3.1 API — Go Docker

API 이미지는 Go 서버를 빌드해 실행한다. 서버 전용 설정은 API 컨테이너에만 둔다.

```bash
docker compose build api
docker compose up -d api
curl http://localhost:3001/api/health   # {"ok":true}
```

API 호스트에는 서버 전용 환경변수(`SUPABASE_SECRET_KEY`, `OPEN_ROUTER_API_KEY`, VAPID private key 포함)를 설정한다. web 빌드에는 넣지 않는다.

### 3.2 정적 web + Compose

web 이미지는 빌드 시 SPA shell과 에셋을 생성하고 `.output/public`만 정적 Caddy 이미지에 복사한다. 런타임에 Node/Nitro 서버는 실행하지 않는다.

저장소의 모든 외부 이미지는 Podman의 short-name alias 설정 없이도 동작하도록 `docker.io/...` 완전 이름을 사용한다. 아래 명령은 Docker Compose와 Podman Compose 모두에서 사용할 수 있다.

```bash
docker compose build
docker compose up -d
docker compose ps          # 두 서비스 모두 healthy 확인
curl http://localhost:3001/api/health   # {"ok":true}
curl -I http://localhost:3000/login     # 200
```

- api 헬스체크: `GET /api/health`, web 헬스체크: `GET /manifest.webmanifest` (Compose에 내장).
- readiness: `GET /api/health/ready`가 DB·Push·리마인더 cron 상태를 민감정보 없이 반환한다.
- api는 기동 시 VAPID 설정이 완전할 때만 리마인더 cron을 시작한다. 로그에서 확인:
  `docker compose logs api | grep -i cron`
- Uptime Kuma는 `127.0.0.1:3002`에만 공개되며 데이터는 로컬 `uptime-kuma-data` volume에 저장된다. Docker socket은 마운트하지 않는다.

## 4. 기존 운영 Caddy와 HTTPS

**PWA 설치와 Web Push는 HTTPS가 필수**다(localhost 제외). 집 서버의 실제 `~/containers/my-bookmark/compose.yaml`은 저장소 밖에서 관리하며 빌드 컨텍스트는 `../../apps/my-bookmark`다. 기존 외부 Caddy(`~/containers/my-bookmark/Caddyfile`)는 `:8080`에서 민감 경로를 404 처리하고 `/api/*`를 `api:3001`, 나머지를 `web:3000`으로 프록시한다. Tailscale 경로, 접근 제한, Caddy 설정과 서비스 간 네트워크를 그대로 유지한다. 이 운영 Compose에서는 포트를 호스트 loopback에 게시하지 않으므로 위 로컬 Compose의 `localhost:3000/3001` 점검 명령을 그대로 적용하지 않는다.

기존 운영 Caddy가 API로 직접 프록시하므로 정적 web 컨테이너가 추가돼도 API 경로의 프록시 hop 수는 늘지 않는다. 기존 `TRUST_PROXY` 설정을 유지하고 실제 경로에서 클라이언트 IP를 검증한다. web의 정적 Caddy도 로컬 Compose에서 `/api/*`를 API 컨테이너로 프록시하므로 다른 경로에서 web을 통해 API로 전달한다면 hop이 하나 늘어난다.

정적 Caddy 컨테이너는 운영 Caddy 외에 서버 프로세스 하나가 더 필요하지만, 저장소 밖 Caddy 설정이나 정적 파일 마운트를 변경하지 않고 기존 포트·TLS 경계를 유지한다. `apps/web/Caddyfile`은 SPA 경로를 `index.html`로 폴백하되 누락된 정적 파일은 404로 반환하고, 기존 SW/자산 캐시 정책을 적용한다. 운영 Caddy에 캐시 헤더를 덮어쓰는 규칙이 없는지도 확인한다.

운영 적용 시 저장소 밖 Compose·Caddy 설정을 보존하고 해당 운영 Compose 디렉터리에서 web 이미지를 재빌드·교체한다. 이 Compose는 다섯 `VITE_*` 빌드 인자를 `~/containers/my-bookmark/.env`에서 읽는다. 값은 빌드 시 고정되며 변경 시 재빌드가 필요하다. `VITE_API_URL`을 비우면 운영 Caddy와 같은 origin의 `/api/*`를 사용하며, 별도 origin을 사용하는 현재 값이 있으면 의도 확인 없이 덮어쓰지 않는다. 배포 후 실제 도메인에서 `/login`, `/map` 직접 진입, `/api/health`, 없는 `/assets/…`의 404, `/sw.js`와 CSS 캐시 헤더를 확인한다. Kuma가 별도로 운영 중이면 기존 접근 제한도 유지한다.

## 5. Supabase 설정 요약

- Auth → URL Configuration: Site URL을 배포 도메인으로.
- Auth → Sign In / Up: 신규 가입 차단 유지.
- 마이그레이션: `supabase/migrations`를 `bunx supabase db push`로 반영 (CI/수동).
- api는 secret key로 접근하므로 RLS는 심층 방어용 — 정책 변경 불필요.

## 6. iOS 푸시 확인 체크리스트 (배포 후)

iOS는 **홈 화면에 설치된 PWA에서만** Web Push가 동작한다 (iOS 16.4+).

1. Safari에서 배포 도메인(HTTPS) 접속 → 로그인
2. 공유 → **홈 화면에 추가**
3. 홈 화면 아이콘으로 실행 (Safari 탭이 아니라 standalone)
4. 설정 → 알림 켜기 (버튼 탭 = 사용자 제스처 안에서 권한 요청됨)
5. "테스트 알림" 수신 확인
6. 북마크에 2분 뒤 리마인더 설정 → 정시 수신 + 탭 시 북마크 URL 열림 확인
7. 실패 시: iOS 설정 → 알림 → 해당 PWA 허용 여부, 저전력 모드/집중 모드 확인

## 7. 운영 메모

### Uptime Kuma + Discord

Kuma에 비공개 Discord 알림을 만들고 다음 HTTP 모니터에 연결한다.

| 이름 | 대상 | 주기 | Retries |
|---|---|---:|---:|
| `[home-prod] web` | Caddy 경유 `/login` | 60초 | 2 |
| `[home-prod] api` | Caddy 경유 `/api/health` | 30초 | 2 |
| `[home-prod] api-readiness` | Caddy 경유 `/api/health/ready` | 60초 | 2 |

Down/Up만 전송하고 정상 heartbeat와 공개 status page는 끈다. 같은 집 서버에서 Kuma도 실행하므로 정전, Docker daemon 중단, 회선 또는 Tailscale 전체 장애는 알릴 수 없다.

API는 동일 IP의 인증 실패 1분 5회, 민감 API 경로 1회, route miss 5분 20회, parser/413 10분 5회, 429 10분 20회와 cron·Push·AI·500/502 오류를 알린다. 전체 IP를 표시하지만 인증값, cookie, query/body, 북마크 내용, AI 원문은 보내지 않는다. 자동 차단은 없으며 필요하면 Tailscale에서 장치를 수동 제거한다.

배포 후 web/API 컨테이너 중지·복구, readiness 실패·복구, 한 IP의 인증 실패 5회, `/api/.env` 요청을 차례로 시험한다. Discord Webhook을 일시적으로 잘못 설정해도 앱 요청과 cron이 계속 동작하는지 확인한다.

- 로그: `docker compose logs -f api` (Go 표준 `log` 텍스트 출력, pino JSON 아님). `Authorization`/`X-API-Key` 요청 헤더는 로깅하지 않는다.
- 종료: `docker compose down` — api는 SIGTERM에서 cron 중지 후 서버를 닫는다(graceful).
- 이미지 갱신 배포: `git pull && docker compose build && docker compose up -d`.
- 시드/정리(개발용): `bun run --filter @my-bookmark/api seed:bookmarks -- [--count N] [--clean]` — `https://seed.my-bookmark.test/…` URL만 건드린다.
