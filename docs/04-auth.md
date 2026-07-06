# 04. 인증

1인 사용 서비스의 접근 제어. 두 레이어로 구성:

1. **웹앱**: Supabase Auth (이메일+비밀번호) — 신규 가입 차단, 계정 1개
2. **단축어/스크립트**: API Key (`X-API-Key`)

## Supabase 프로젝트 설정 (수동, 구현 전 1회)

Supabase 대시보드에서:

1. 프로젝트 생성 → `SUPABASE_URL`, publishable key, secret key 확보
2. **Authentication → Sign In / Up → "Allow new users to sign up" OFF** ← 핵심. 이걸로 외부인의 계정 생성이 원천 차단된다
3. Authentication → Users → **Add user**로 본인 계정 1개 수동 생성 (이메일 확인 없이 "Auto Confirm" 사용)
4. Email provider만 활성화, OAuth provider는 전부 비활성화

> 참고: 가입 차단 전에 생성된 계정은 계속 로그인 가능하다. 계정은 반드시 1개만 만든다.

## 웹 로그인 플로우 (apps/web)

- `lib/supabase.ts`: `createClient(VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY)` — 브라우저에서 세션은 localStorage에 저장되고 supabase-js가 자동 갱신한다.
- `/login` 라우트: `signInWithPassword({ email, password })`. 성공 시 `/`로 이동.
- 라우트 가드: `_authed.tsx` 레이아웃 라우트에서 세션 없으면 `/login`으로 redirect. TanStack Router의 `beforeLoad`에서 처리.
- API 호출: `lib/api-client.ts`가 매 요청 전에 `supabase.auth.getSession()`으로 현재 access token을 가져와 `Authorization: Bearer`로 첨부. 401 응답 시 세션 refresh 후 1회 재시도, 그래도 실패하면 로그인으로.
- 로그아웃: `signOut()` + Query 캐시 clear.

**SSR 주의**: 세션이 localStorage에 있으므로 서버 렌더 시점엔 인증 상태를 모른다. 이 앱은 데이터가 전부 클라이언트 fetch(TanStack Query)이므로 문제없다 — 라우트 가드는 클라이언트에서 동작하면 충분하고, SSR로 데이터를 미리 채우려는 시도를 하지 말 것 (복잡도만 늘어난다).

## Express에서 Supabase JWT 검증

Supabase는 2025-10 이후 신규 프로젝트에 **비대칭 JWT 서명 키**를 기본 적용한다. 검증은 JWKS 공개키로 로컬에서 수행한다 — 요청마다 Supabase API를 호출하지 않는다(`auth.getUser()` 방식 금지, 느리고 불필요).

```ts
// middleware/auth.ts 개요 — jose 사용
import { createRemoteJWKSet, jwtVerify } from 'jose';

const jwks = createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/jwks`)); // 모듈 레벨 1회, jose가 캐싱

export async function bearerAuth(token: string): Promise<string /* userId */> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `${env.SUPABASE_URL}/auth/v1`,
    audience: 'authenticated',
  });
  return payload.sub!;
}
```

- `createRemoteJWKSet`은 키를 캐싱하고 미지의 `kid`가 오면 자동 refetch한다. JWKS 엔드포인트는 Supabase 엣지에서 10분 캐시되므로 키 로테이션 직후 잠깐의 지연이 있을 수 있다(1인 서비스에선 무시 가능).
- **레거시 프로젝트 폴백**: 프로젝트가 구형 HS256(shared secret)이면 JWKS에 키가 없다. 그 경우 `SUPABASE_JWT_SECRET` env를 추가하고 `jwtVerify(token, secret)`로 검증하는 분기를 둔다. 어느 쪽인지는 대시보드 Settings → JWT Keys에서 확인(구현 시점에 확인해서 한쪽만 구현해도 됨 — 결정을 PROGRESS.md에 기록).

## API Key 설계

- **생성**: `crypto.randomBytes(32)` → base64url → `bm_` 접두사. 예: `bm_Xk3…` (총 46자 내외)
- **저장**: sha256(key) hex를 `api_keys.key_hash`에 저장. 원문은 생성 응답에서 1회만 노출, 서버에 남기지 않는다.
- **검증 미들웨어**: `X-API-Key` 헤더 → sha256 → `key_hash` 일치 + `revoked_at IS NULL` 조회 → `req.userId` 세팅. 성공 시 `last_used_at`을 갱신하되 **분당 1회로 스로틀**(매 요청 UPDATE 방지) — 인메모리 타임스탬프로 충분.
- 해시 조회는 unique index라 타이밍 공격 표면이 사실상 없지만, 비교가 필요한 곳에선 `crypto.timingSafeEqual`을 쓴다.
- **권한 범위**: API Key는 bookmarks/categories 라우트만. 라우터 마운트 시 `requireAuth({ apiKey: true })` / `requireAuth()` 옵션으로 구분.
- **회수**: 삭제 대신 `revoked_at` 세팅 (감사 기록 유지).

## 미들웨어 구조

```
requireAuth(opts) →
  1. Authorization: Bearer 있으면 JWT 검증 → req.userId
  2. 없고 X-API-Key 있으면 (opts.apiKey 허용 시) 키 검증 → req.userId
  3. 둘 다 실패 → 401 UNAUTHORIZED
```

`req.userId`는 이후 모든 쿼리에서 `.eq('user_id', req.userId)` 필터로 사용한다. secret key가 RLS를 bypass하므로 **이 필터를 빠뜨리면 안 된다** — 서비스 레이어 헬퍼로 강제한다.

## 검토했던 대안 (기록)

| 방식 | 탈락 이유 |
|---|---|
| Passkey (WebAuthn) | Supabase Auth 네이티브 미지원 → simplewebauthn + 자체 세션 필요, 구현 비용 과다 |
| Magic Link | 로그인마다 메일 확인 필요, 모바일 UX 저하 |
| 네트워크 차단 (Tailscale 등) | iPhone에서 VPN 상시 연결 필요, 단축어/푸시 연동 번거로움 |
