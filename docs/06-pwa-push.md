# 06. PWA + Web Push

요구사항 4(PWA/모바일), 7(리마인더 알림), 8(PWA 알림에 필요한 기술)을 다룬다.

## PWA 알림에 필요한 기술 — 개념 정리 (요구사항 8)

| 기술 | 역할 |
|---|---|
| **Web App Manifest** | 홈 화면 설치 가능하게 함 (`manifest.webmanifest`: 이름, 아이콘, `display: standalone`) |
| **Service Worker (SW)** | 페이지가 닫혀 있어도 백그라운드에서 실행되는 스크립트. 푸시 수신의 실행 주체 |
| **Push API** | 브라우저가 푸시 서비스에 구독을 만들고(`pushManager.subscribe`), SW가 `push` 이벤트를 받게 함 |
| **Notification API** | 수신한 푸시를 OS 알림으로 표시 (`registration.showNotification`) |
| **Web Push 프로토콜 (RFC 8030) + VAPID (RFC 8292)** | 서버가 푸시 서비스(Apple/Google/Mozilla의 인프라)로 암호화된 메시지를 보내는 표준. VAPID 키쌍으로 서버 신원 증명. Node에선 `web-push` 패키지가 전부 처리 |
| **HTTPS** | SW·푸시·설치 모두 보안 컨텍스트 필수 (localhost는 예외) |

동작 흐름:

```
[등록]  웹앱: 권한 요청 → pushManager.subscribe(VAPID 공개키)
        → 구독 객체(endpoint+키)를 서버에 저장
[발송]  node-cron이 도래한 리마인더 발견
        → web-push.sendNotification(구독, payload)   ← 서버는 푸시 서비스로 보낼 뿐
        → 푸시 서비스(APNs/FCM/Mozilla)가 기기로 전달
[수신]  SW 'push' 이벤트 → showNotification(제목, 본문, 아이콘, data)
        SW 'notificationclick' → 북마크 URL 열기
```

### iOS(iPhone) 제약 — 중요

- **iOS 16.4 이상**에서만 웹 푸시 지원.
- **홈 화면에 추가(설치)된 PWA에서만** 푸시 가능. Safari 탭 상태에선 불가.
- 알림 권한 요청은 **사용자 제스처(버튼 탭) 안에서만** 유효. 페이지 로드 시 자동 요청하면 조용히 실패한다.
- manifest에 `display: standalone` 필수.
- 사용자가 홈 화면에서 PWA를 삭제하면 구독이 무효화된다 → 서버는 발송 실패(404/410)로 감지해 정리.
- payload 크기 제한 ~4KB. 제목+본문+URL 정도만 담는다.

## 구현 — 서비스 워커 빌드 (핵심 함정)

**`vite-plugin-pwa`는 TanStack Start 프로덕션 빌드와 호환 문제가 있다** (TanStack/router#4988 — 플러그인의 SW 생성 스텝이 실행되지 않음). 우회하지 말고 처음부터 다음 전략을 쓴다:

- `src/sw/sw.ts`에 SW를 **직접 작성**하고, **별도 esbuild 스텝**으로 `public/sw.js`에 번들한다.
  - dev: `esbuild src/sw/sw.ts --bundle --outfile=public/sw.js --watch`를 dev 스크립트에 병렬로 추가
  - build: 같은 명령(–watch 없이)을 web 빌드 앞에 실행
- 앱 진입점에서 `navigator.serviceWorker.register('/sw.js')`로 수동 등록.
- 이 앱은 인증 뒤의 동적 데이터가 전부라 **정밀한 precache가 필요 없다**. Workbox 전체를 도입하지 말 것 — 아래 수준의 손코딩이 오히려 단순하고 디버깅 쉽다.

### sw.ts 필수 구성

```ts
// 1) 푸시 수신
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(self.registration.showNotification(data.title ?? '북마크 리마인더', {
    body: data.body, icon: '/icons/icon-192.png', badge: '/icons/badge.png',
    data: { url: data.url },
  }));
});

// 2) 알림 클릭 → 북마크 원본 URL 열기
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url;
  if (url) event.waitUntil(self.clients.openWindow(url));
});

// 3) 가벼운 런타임 캐시 (08-performance의 전략 준수)
//    - 정적 자산(/assets/*): cache-first
//    - GET /api/bookmarks, /api/categories: network-first (오프라인 읽기용)
//    - 그 외: 네트워크 직행
```

- `push` 핸들러에서 `showNotification`을 **반드시 호출**한다 — iOS/크롬 모두 푸시를 받고 알림을 안 띄우면 이후 구독이 불이익을 받는다.
- SW 업데이트: `skipWaiting` + `clients.claim`으로 단순하게. (1인 서비스 — 정교한 업데이트 UX 불필요)

## Manifest (apps/web/public/manifest.webmanifest)

```json
{
  "name": "My Bookmark", "short_name": "Bookmark",
  "start_url": "/", "display": "standalone",
  "background_color": "#0a0a0a", "theme_color": "#0a0a0a",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

아이콘은 단순한 도형+글자로 생성(placeholder 수준이면 됨). `__root.tsx`의 head에 manifest 링크 + `apple-touch-icon` + `theme-color` 메타를 넣는다.

## 클라이언트 구독 플로우 (apps/web/src/lib/push.ts)

설정 화면의 "알림 켜기" 버튼(사용자 제스처) 안에서:

```
1. 지원 확인: 'serviceWorker' in navigator && 'PushManager' in window
   - iOS Safari 탭(미설치)이면 "홈 화면에 추가 후 사용 가능" 안내 표시
2. Notification.requestPermission() → 'granted' 아니면 안내 후 중단
3. registration.pushManager.subscribe({ userVisibleOnly: true,
     applicationServerKey: urlBase64ToUint8Array(VITE_VAPID_PUBLIC_KEY) })
4. POST /api/push/subscriptions (구독 JSON 그대로)
5. "테스트 알림 보내기" 버튼 → POST /api/push/test로 즉시 검증 가능하게
```

끄기: `subscription.unsubscribe()` + `POST /api/push/unsubscribe`.

## 서버 발송 (apps/api)

- `services/push-sender.ts`: `web-push` 설정(`setVapidDetails(VAPID_SUBJECT, 공개키, 비밀키)`). `sendNotification(subscription, JSON.stringify(payload))`.
- **404/410 응답 → 그 구독을 DB에서 삭제** (만료/설치 해제). 그 외 실패는 로그만.
- payload: `{ title, body, url }` — title은 "🔖 <북마크 제목>", body는 note 또는 domain, url은 북마크 원본 URL.

## 리마인더 스케줄러 (services/reminder-cron.ts)

```
node-cron '* * * * *' (매분):
1. select * from reminders where status='pending' and remind_at <= now() limit 20
2. 각 건: update … set status='sent', sent_at=now()
          where id=? and status='pending' 조건부 업데이트로 클레임
          (영향 행 0이면 skip — 중복 발송 방지)
3. 클레임 성공 건만 해당 user의 전체 구독에 발송
4. 전 구독 발송 실패 시: 로그 남기고 그대로 둔다 (단순화 — 재시도 큐 없음, 결정 로그 참조)
```

- cron 시작은 서버 리슨 후, SIGTERM 시 중지.
- 서버가 꺼져 있던 동안 지난 리마인더는 재기동 후 첫 tick에서 발송된다 (`remind_at <= now()` 조건이라 자연 처리).

## 로컬 개발/테스트

- localhost는 보안 컨텍스트 취급 → 데스크톱 Chrome에서 SW/푸시 전부 로컬 테스트 가능. `POST /api/push/test`로 E2E 확인.
- iOS 실기기 테스트는 HTTPS 배포 후에만 가능하다. Phase 6 수용 기준은 데스크톱 기준으로 하고, iOS 확인은 배포 후 항목으로 분리.
