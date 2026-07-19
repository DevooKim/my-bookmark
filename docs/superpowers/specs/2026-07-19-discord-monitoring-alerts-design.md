# Discord 모니터링·비정상 접근 알림 설계

## 목표

집 서버의 Docker Compose로 자체 호스팅하는 my-bookmark의 서비스 장애, 핵심 백그라운드 작업 실패, 비정상 접근 징후를 비공개 Discord 채널에서 확인한다. 서비스 가용성은 Uptime Kuma가 감시하고, API 내부에서만 알 수 있는 업무 오류와 접근 패턴은 Express가 감지한다.

집 서버 전체의 정전, Docker daemon 중단, 인터넷 회선 또는 Tailscale 전체 장애 감지는 범위에서 제외한다. Uptime Kuma도 같은 집 서버에서 실행하므로 호스트가 완전히 중단되면 Discord 알림을 보낼 수 없다.

## 운영 환경과 책임 경계

운영 경로는 `Tailscale → Caddy → web/api`이며, web과 API는 Docker Compose로 실행한다.

- Uptime Kuma: Caddy를 경유한 web/API 가용성, readiness 장애와 복구
- Express API: 리마인더 cron, Web Push, AI 분석, 예상하지 못한 서버 오류, 비정상 접근 집계
- Caddy: Tailscale 내부 진입점과 실제 클라이언트 IP 전달
- Discord: 장애·복구·보안 경고를 받는 비공개 단일 채널

API와 web의 호스트 포트는 `127.0.0.1`에만 바인딩해 Caddy를 우회한 직접 접근을 막는다. API는 `TRUST_PROXY=1`로 Caddy 한 hop만 신뢰하고 `request.ip`에서 실제 출처 IP를 얻는다. Uptime Kuma 관리 화면도 Caddy를 통해 Tailscale 내부에서만 노출한다.

앱용 Discord Webhook URL은 서버 전용 `DISCORD_ALERT_WEBHOOK_URL` 환경변수로 관리하며 web 빌드나 클라이언트 응답에 포함하지 않는다. Uptime Kuma의 Discord Webhook 설정은 Kuma 영구 볼륨에 저장한다. 두 발신자는 같은 비공개 Discord 채널을 사용한다.

Uptime Kuma는 2026-07-19 기준 최신 안정 버전인 `louislam/uptime-kuma:2.4.0`과 로컬 Docker volume을 사용한다. NFS에는 Kuma 데이터 디렉터리를 두지 않는다.

## Uptime Kuma 모니터

다음 세 모니터를 Caddy 경유 주소에 구성한다.

| 이름 | 대상 | 주기 | 장애 판정 | 복구 판정 |
|---|---|---:|---:|---:|
| `[home-prod] web` | 로그인 페이지 | 60초 | 최초 실패 후 재시도 2회도 실패 | 다음 1회 성공 |
| `[home-prod] api` | `GET /api/health` | 30초 | 최초 실패 후 재시도 2회도 실패 | 다음 1회 성공 |
| `[home-prod] api-readiness` | `GET /api/health/ready` | 60초 | 최초 실패 후 재시도 2회도 실패 | 다음 1회 성공 |

기존 `/api/health`는 프로세스가 HTTP 요청을 받을 수 있는지만 확인하는 liveness로 유지한다. 새 `/api/health/ready`는 민감한 설정값을 노출하지 않고 다음 상태를 확인한다.

```json
{
  "ok": true,
  "checks": {
    "database": "ok",
    "push": "ok",
    "reminderCron": "ok"
  }
}
```

필수 점검 중 하나라도 실패하면 `ok: false`와 non-2xx 상태를 반환한다. 응답에는 URL, 키, 토큰, DB 오류 원문을 넣지 않는다. Uptime Kuma의 `Retries`를 2로 설정해 최초 실패 뒤 두 번 더 실패해야 Down으로 전환한다. Down 이후 다음 heartbeat가 성공하면 Up으로 복구한다. Kuma는 장애 전환과 복구 전환에만 Discord 알림을 보내며 매번의 정상 확인은 알리지 않는다.

## 애플리케이션 장애 알림

다음 사건은 즉시 알린다.

- 리마인더 cron 실행 중 예외
- 도래 리마인더를 클레임했지만 만료된 구독을 제외한 모든 Push 전송이 실패
- 예상하지 못한 HTTP 500 오류
- Supabase, Storage, 인증 JWKS 같은 외부 의존성 장애로 핵심 요청을 처리할 수 없음

다음 사건은 임계치를 넘을 때 경고한다.

- AI 분석이 15분 안에 3회 연속 실패하거나 총 5회 실패
- 일부 Push 전송 실패는 15분 동안 집계
- due reminder 조회 한도 20개가 3회 연속 가득 차서 backlog가 의심됨
- HTTP 429가 10분 안에 20회 이상 발생

동일 cron 오류는 첫 실패에 알리고 다음 정상 실행에서 복구를 알린다. Push 구독의 404/410 응답과 그에 따른 구독 삭제는 정상 만료 처리이므로 알리지 않는다. 북마크 CRUD 성공, 매분 cron 정상 실행, 단일 AI 실패, 일반적인 4xx도 알리지 않는다.

## 비정상 접근 감지

Express 요청 처리 경계에 인메모리 보안 이벤트 집계기를 둔다. 실제 출처 IP별 sliding window를 사용하며 여러 IP의 발생 횟수를 합산하지 않는다.

| 사건 | 기준 | 알림 |
|---|---|---|
| Bearer 또는 API Key 인증 실패 | 동일 IP에서 1분 내 5회 | Warning |
| 민감 경로 탐색 | `/.env`, `/.git`, `/wp-admin` 계열 또는 경로 순회 패턴 1회 | 즉시 Warning |
| 존재하지 않는 경로·method 탐색 | 동일 IP에서 404/405가 5분 내 20회 | Warning |
| 대용량·비정상 요청 | 동일 IP에서 413 또는 JSON/multipart parser 오류가 10분 내 5회 | Warning |
| rate limit 도달 | 동일 IP에서 429가 10분 내 20회 | Warning |

단일 세션 만료, 일반적인 입력 오류, 정상적인 토큰 갱신 과정은 알리지 않는다. 보안 알림에는 사용자가 승인한 대로 전체 출처 IP, 정규화된 경로, HTTP method/status, 집계 건수, 최초·최근 시각을 표시한다.

자동 임시 차단, 영구 차단, Caddy·방화벽 규칙 변경은 하지 않는다. 알림 확인 후 필요하면 Tailscale 관리 화면에서 장치를 수동 제거한다.

집계기는 단일 Docker 인스턴스의 메모리에만 상태를 유지하고 컨테이너 재시작 시 초기화한다. Redis, 별도 이벤트 테이블, 장기 접근 이력 저장은 추가하지 않는다.

## 메시지 형식과 심각도

심각도는 세 단계만 사용한다.

- `CRITICAL`(빨강): 서비스나 핵심 기능 사용 불가
- `WARNING`(노랑): 일부 기능 실패, 비정상 접근 또는 임계치 초과
- `RECOVERED`(초록): 이전 장애가 정상으로 전환됨

애플리케이션 메시지는 다음 필드를 사용한다.

```text
🟡 [WARNING] 반복 인증 실패
환경: home-production
컴포넌트: authentication
출처 IP: 100.87.42.16
경로: /api/bookmarks
발생량: 최근 1분간 7회
최초/최근: 21:14:02 / 21:14:48 KST
오류 ID: authentication:unauthorized
```

가용성 복구 메시지에는 장애 지속 시간과 정상 확인 횟수를 포함한다. KST 표시와 함께 기계 판독용 UTC 시각도 payload에 유지한다.

메시지에는 Authorization, API Key 원문·해시, cookie, query 값, 요청 본문, 북마크 URL·제목, AI 응답 원문, DB 오류 원문을 포함하지 않는다. 요청 추적이 필요하면 request ID와 내부 오류 코드만 사용한다.

## 중복 억제와 집계

오류 지문은 `component + errorCode + 정규화된 메시지`로 만든다. 보안 이벤트는 여기에 출처 IP를 포함한다.

- 즉시 알림 사건은 같은 지문의 최초 오류에 전송한다. 임계치 기반 사건은 해당 sliding window의 기준을 처음 넘을 때 전송한다.
- 이후 10분 동안 같은 메시지는 억제하고 횟수를 누적한다.
- 억제 기간 뒤에도 다시 발생하면 직전 10분의 발생 건수를 포함해 재전송한다.
- cron은 실패 상태를 기억하고 다음 정상 실행에서 한 번만 복구 알림을 전송한다.
- Uptime Kuma의 연속 실패·성공 판정과 앱 내부 오류 집계는 서로 독립적이다.

집계 상태는 메모리에만 두며 재시작 후 같은 장애가 다시 발생하면 새로운 최초 알림을 허용한다. 개인용 단일 인스턴스에서 재시작 직후의 한 번의 중복 가능성보다 저장 계층을 추가하지 않는 단순성을 우선한다.

## Discord 전송 실패 처리

Discord 알림은 원래 HTTP 요청, cron, Push, AI 작업의 성공 여부를 바꾸지 않는 best-effort 보조 경로다.

- Webhook 요청에 짧은 timeout을 적용한다.
- Discord 429와 5xx만 최대 한 번 재시도한다.
- 최종 실패는 민감정보 없이 pino에 기록한다.
- Discord 전송 실패를 다시 Discord로 알리지 않는다.
- 애플리케이션 종료를 Webhook 응답 대기로 장시간 지연하지 않는다.

## 테스트와 운영 검증

자동 테스트는 다음을 고정한다.

- Discord payload 형식과 민감정보 제거
- 동일 오류의 10분 중복 억제와 다음 알림의 집계 건수
- IP별 인증 실패 1분 5회 기준과 IP 간 격리
- 민감 경로 즉시 감지
- 404/405, 413/malformed, 429의 각 sliding window 임계치
- cron 실패 후 정상 실행 시 단일 복구 알림
- AI, Push, reminder backlog 임계치
- readiness의 DB·Push·cron 상태와 비밀값 비노출
- Discord timeout, 429, 5xx 재시도와 최종 실패
- Discord 장애가 API 응답과 cron 처리 결과를 바꾸지 않음

배포 후 다음 장애 훈련을 수행한다.

1. web 컨테이너를 중지해 장애 알림을 확인하고 재기동해 복구 알림을 확인한다.
2. API 컨테이너에도 같은 절차를 수행한다.
3. readiness 의존성 하나를 의도적으로 실패시켜 장애·복구를 확인한다.
4. 테스트 IP에서 인증 실패 5회와 민감 경로 요청을 발생시켜 전체 IP가 포함된 보안 경고를 확인한다.
5. Discord Webhook을 일시적으로 잘못 설정해 앱 기능이 계속 동작하는지 확인한다.
6. Discord 메시지와 pino 로그에 키, 토큰, cookie, 요청 본문이 없는지 확인한다.
7. Uptime Kuma 관리 화면이 Tailscale 밖에서 노출되지 않는지 확인한다.

전체 코드 검증은 `bun run typecheck && bun run lint && bun run test && bun run build`를 통과해야 한다. 배포 문서에는 Discord Webhook 생성, Kuma 초기 설정, 모니터 복원, 장애 훈련, 수동 Tailscale 차단 절차를 기록한다.

## 범위 제외

- 집 서버 전체 정전, Docker daemon 중단, 인터넷·Tailscale 전체 장애 알림
- 자동 IP 차단, 방화벽 변경, CrowdSec·Fail2ban 도입
- 로그 수집·검색 플랫폼과 장기 보안 이벤트 보관
- 정상 실행 heartbeat, 정상 CRUD, cron 매회 성공 알림
- Discord Bot과 양방향 명령; 수신 전용 Webhook만 사용

## 완료 기준

Kuma가 Caddy 경유 web/API/readiness 장애와 복구를 Discord로 알리고, API가 정의된 업무 장애와 비정상 접근 임계치를 중복 없이 알린다. Discord가 실패해도 앱 기능은 계속 동작하며, 알림에는 전체 출처 IP 외의 민감한 요청 데이터가 포함되지 않아야 한다. 자동 차단 없이 사용자가 Discord 경고를 근거로 Tailscale에서 수동 대응할 수 있어야 한다.
