# 배포 가이드

기본 배포 구성은 `web`(TanStack Start SSR)은 Vercel Bun Runtime Beta, `api`(Express)는 Node.js 24 Docker다. Docker Compose는 로컬 프로덕션 검증과 두 서비스를 함께 자체 호스팅하는 대안으로 유지한다. Supabase는 클라우드를 사용한다.

## 0. 사전 준비 체크리스트

- [ ] Supabase 프로젝트 생성 완료, `ai_settings` 포함 최신 마이그레이션 반영(`bunx supabase db push`)
- [ ] Supabase Auth 설정: 이메일/비밀번호 로그인 활성, **신규 가입 차단**(개인용), 계정 1개 생성 — 상세는 `docs/04-auth.md`
- [ ] `.env` 작성 (아래 표)
- [ ] VAPID 키 생성 (아래)
- [ ] API를 실행할 Docker 호스트
- [ ] 저장소와 연결된 Vercel 프로젝트 (`apps/web`을 Root Directory로 설정)

## 1. 환경변수 (.env)

`.env.example`을 복사해 채운다. Compose가 같은 파일을 변수 치환(`${…}`)과 `env_file` 모두에 사용한다.

| 변수 | 용도 | 비고 |
|---|---|---|
| `PORT` | api 포트 | 기본 3001 |
| `WEB_ORIGIN` | api CORS 허용 origin | 배포 도메인 (예: `https://bm.example.com`) |
| `SUPABASE_URL` | Supabase 프로젝트 URL | |
| `SUPABASE_SECRET_KEY` | secret key (`sb_secret_…`) | **서버 전용. 절대 클라이언트 노출 금지** |
| `AI_SETTINGS_ENCRYPTION_KEY` | AI provider API 키 암호화 마스터 키 | `openssl rand -base64 32`로 최초 1회 생성. **교체하면 저장된 키를 복호화할 수 없음** |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push 서명키 | 아래 생성 절차 |
| `VAPID_SUBJECT` | `mailto:…` | |
| `TRUST_PROXY` | 리버스 프록시 hop 수 | Caddy 등 프록시 뒤에서는 `1` — 미설정 시 rate limit이 프록시 IP를 클라이언트로 본다 |
| `VITE_SUPABASE_URL` | 웹 클라이언트용 | 빌드 시점에 번들에 포함 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable key (`sb_publishable_…`) | 공개 가능 |
| `VITE_API_URL` | 브라우저가 접근하는 api 주소 | 배포 시 `https://bm.example.com/api`가 아니라 **api 서버의 공개 주소** (예: `https://api.bm.example.com` 또는 리버스 프록시 경유 동일 도메인) |
| `VITE_VAPID_PUBLIC_KEY` | 푸시 구독용 공개키 | `VAPID_PUBLIC_KEY`와 동일 값 |

주의: `VITE_*` 값은 **web 이미지 빌드 시점**에 번들로 구워진다. 값을 바꾸면 `docker compose build web`을 다시 해야 한다.

AI provider와 provider별 API 키는 배포 후 웹의 **설정 → AI 분류**에서 저장한다. `.env`의 provider/API 키 fallback은 없으며 키 원문은 설정 조회 응답에 다시 노출되지 않는다.

## 2. VAPID 키 생성

```bash
bunx --no-install web-push generate-vapid-keys
```

출력된 Public/Private key를 `.env`의 `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VITE_VAPID_PUBLIC_KEY`에 넣는다. 상세는 `docs/vapid-guide.md`.

**키를 교체하면 기존 푸시 구독이 전부 무효화**된다(브라우저에서 알림을 다시 켜야 함).

## 3. 배포

### 3.1 API — Node.js 24 Docker

API 이미지는 Bun으로 의존성을 설치하고 빌드하지만, 최종 컨테이너는 Node.js 24 LTS에서 실행된다.

```bash
docker compose build api
docker compose up -d api
curl http://localhost:3001/api/health   # {"ok":true}
```

API 호스트에는 서버 전용 환경변수(`SUPABASE_SECRET_KEY`, `AI_SETTINGS_ENCRYPTION_KEY`, VAPID private key 포함)를 설정한다. web의 Vercel 프로젝트에는 이 값을 넣지 않는다.

### 3.2 web — Vercel Bun Runtime Beta

Vercel 프로젝트 설정:

1. 저장소를 연결하고 **Root Directory**를 `apps/web`으로 지정한다.
2. 저장소 루트의 `bun.lock`으로 Bun 설치가 자동 감지되는지 배포 로그에서 확인한다.
3. Build Command는 package script인 `bun run build`를 사용한다. `VERCEL=1` 환경에서 Nitro가 Vercel preset을 자동 선택한다.
4. `apps/web/vercel.json`의 `bunVersion: "1.x"`가 Vercel Functions를 Bun Runtime Beta로 실행한다.
5. `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_URL`, `VITE_VAPID_PUBLIC_KEY`를 Preview와 Production 환경에 설정한다.

`VITE_API_URL`은 브라우저에서 접근 가능한 HTTPS API origin이어야 한다. 배포 로그에는 `[nitro:vercel] Using bun1.x runtime`과 `.vercel/output/functions` 생성이 나타나야 한다.

### 3.3 Docker Compose 대안

```bash
docker compose build
docker compose up -d
docker compose ps          # 두 서비스 모두 healthy 확인
curl http://localhost:3001/api/health   # {"ok":true}
curl -I http://localhost:3000/login     # 200
```

- api 헬스체크: `GET /api/health`, web 헬스체크: `GET /manifest.webmanifest` (Compose에 내장).
- api는 기동 시 VAPID 설정이 완전할 때만 리마인더 cron을 시작한다. 로그에서 확인:
  `docker compose logs api | grep -i cron`

## 4. 자체 호스팅 HTTPS / 리버스 프록시 (Caddy)

**PWA 설치와 Web Push는 HTTPS가 필수**다(localhost 제외). Vercel은 web HTTPS를 제공한다. Docker Compose로 두 서비스를 자체 호스팅할 때는 Caddy를 앞단에 둔다.

`Caddyfile` 예시 (web과 api를 한 도메인에서 서빙 — CORS 불필요):

```caddy
bm.example.com {
    handle /api/* {
        reverse_proxy api:3001
    }
    handle {
        reverse_proxy web:3000
    }
}
```

compose 오버라이드 예시 (`docker-compose.override.yml`):

```yaml
services:
  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
    depends_on: [web, api]
volumes:
  caddy_data:
```

단일 도메인 구성 시 `.env`는 `WEB_ORIGIN=https://bm.example.com`, `VITE_API_URL=https://bm.example.com`으로 설정하고 web 이미지를 다시 빌드한다. 프록시 뒤에서는 `TRUST_PROXY=1`도 설정해 api가 `X-Forwarded-For`의 실제 클라이언트 IP를 보게 한다(API Key rate limit 정확도).

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

- 로그: `docker compose logs -f api` (pino JSON). `Authorization`/`X-API-Key` 헤더는 redact됨.
- 종료: `docker compose down` — api는 SIGTERM에서 cron 중지 후 서버를 닫는다(graceful).
- 이미지 갱신 배포: `git pull && docker compose build && docker compose up -d`.
- 시드/정리(개발용): `bun run --filter @my-bookmark/api seed:bookmarks -- [--count N] [--clean]` — `https://seed.my-bookmark.test/…` URL만 건드린다.
