# VAPID 키 생성 가이드

Phase 6 Web Push 서버는 VAPID 키쌍이 필요하다. 키는 한 번 생성해 `.env`에 저장하고, 공개키만 웹 클라이언트에 노출한다.

## 생성

```bash
bunx --no-install web-push generate-vapid-keys
```

출력 예:

```text
Public Key:
<B64URL_PUBLIC_KEY>

Private Key:
<B64URL_PRIVATE_KEY>
```

## 환경변수

`apps/api` 서버:

```dotenv
VAPID_PUBLIC_KEY=<Public Key>
VAPID_PRIVATE_KEY=<Private Key>
VAPID_SUBJECT=mailto:you@example.com
```

`apps/web` 클라이언트:

```dotenv
VITE_VAPID_PUBLIC_KEY=<Public Key>
```

주의:

- `VAPID_PRIVATE_KEY`는 절대 `VITE_` 변수로 노출하지 않는다.
- 로컬 Chrome은 `localhost`를 보안 컨텍스트로 취급하므로 테스트 알림을 받을 수 있다.
- iOS는 HTTPS 배포 + 홈 화면에 설치한 PWA에서만 Web Push가 동작한다.
