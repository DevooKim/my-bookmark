# 03. API 스펙 (Express)

Base URL: `{API_URL}/api`. 모든 요청/응답은 JSON. 시간은 ISO 8601(UTC).

## 인증

두 방식 중 하나. 미들웨어가 `req.userId`를 채운다.

| 방식 | 헤더 | 대상 |
|---|---|---|
| Supabase 세션 | `Authorization: Bearer <access_token>` | 웹앱 |
| API Key | `X-API-Key: bm_…` | iOS 단축어, 스크립트 |

- API Key 인증은 **북마크/카테고리 엔드포인트만** 허용한다. 키 관리·푸시·리마인더 엔드포인트는 Bearer 전용 (키 유출 시 피해 최소화).
- `GET /api/health`만 인증 불필요.

## 공통 에러 포맷

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "url is required", "details": {} } }
```

| HTTP | code |
|---|---|
| 400 | `VALIDATION_ERROR` |
| 401 | `UNAUTHORIZED` (토큰/키 없음·무효) |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT` (URL 중복 등 — `details.existingId` 포함) |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL` |

zod 검증 실패는 400 + `details`에 필드별 이슈. 에러 미들웨어 한 곳에서 포맷을 강제한다.

## Bookmarks

### POST /api/bookmarks — 등록 (웹 + 단축어 공용)

```json
{ "url": "https://example.com/post", "mode": "ai", "categoryId": null, "title": null }
```

- `mode`: `ai`(AI 분류) | `manual`(직접 지정, `categoryId` 필수) | `none`(미지정)
- `title`: 선택. 주어지면 메타데이터 fetch 결과보다 우선.

동작 순서:
1. URL 정규화(02-database) → 중복이면 **409** + `details.existingId`
2. 북마크 즉시 생성. `mode=ai`면 `ai_status='pending'`, 아니면 `'idle'` → **201 반환** (여기까지 동기)
3. 백그라운드(fire-and-forget): 메타데이터 fetch(title/description/favicon/og:image) → 저장 → `mode=ai`면 AI 분류 실행 (05-ai)

응답 201: `{ "bookmark": { …전체 필드 } }`. 단축어는 이 응답의 `bookmark.title`을 알림 표시에 활용 가능.

### GET /api/bookmarks — 목록

쿼리: `categoryId` (uuid | `none`=미분류 | 생략=전체), `q` (title/url/description ilike 검색), `cursor`, `limit` (기본 30, 최대 100)

```json
{ "items": [ … ], "nextCursor": "base64(created_at|id)" }
```

keyset 페이지네이션: `(created_at, id) < cursor` order by `created_at desc, id desc`.

### 기타

- `GET /api/bookmarks/:id` → `{ bookmark }`
- `PATCH /api/bookmarks/:id` — `title`, `description`, `categoryId`(null 허용=미분류로), `url` 수정. 카테고리 수동 변경 시 서버가 `ai_status='idle'`로 되돌림
- `DELETE /api/bookmarks/:id` → 204
- `POST /api/bookmarks/:id/categorize` — AI 재분류 트리거 (`ai_status='pending'`으로 바꾸고 202 반환, 백그라운드 실행). `pending` 중이면 409

## Categories

- `GET /api/categories?withCounts=true` → `{ items: [{ id, name, color, sortOrder, bookmarkCount? }] }` (이름순 아닌 `sort_order, created_at` 순)
- `POST /api/categories` `{ name, color? }` → 201. 이름 중복 409
- `PATCH /api/categories/:id` `{ name?, color?, sortOrder? }`
- `DELETE /api/categories/:id` → 204 (소속 북마크는 미분류로)

## Reminders (Bearer 전용)

- `POST /api/reminders` `{ bookmarkId, remindAt, note? }` → 201. `remindAt`이 과거면 400
- `GET /api/reminders?status=pending` → `{ items: [ …, bookmark: { id, title, url } 조인 포함 ] }` (remind_at asc)
- `PATCH /api/reminders/:id` `{ remindAt?, note? }` — pending만 수정 가능
- `DELETE /api/reminders/:id` — 실삭제 대신 `status='cancelled'` → 204

## Push (Bearer 전용)

- `POST /api/push/subscriptions` — body는 `PushSubscription.toJSON()` 그대로: `{ endpoint, keys: { p256dh, auth } }`. upsert(endpoint 기준) → 201
- `POST /api/push/unsubscribe` `{ endpoint }` → 204
- `POST /api/push/test` — 이 사용자의 모든 구독에 테스트 알림 발송 → `{ sent: n, failed: n }` (푸시 설정 검증용)

## AI 설정 (Bearer 전용)

- `GET /api/ai` → 활성 `provider`/`model`, 활성 키 사용 가능 여부 `enabled`, provider별 `{ configured }` 반환. 키 원문/암호문은 반환하지 않음
- `PUT /api/ai` `{ provider, model, apiKey? }` → 고정 카탈로그의 provider/model 선택 저장. `apiKey`가 있으면 해당 provider 키를 암호화해 신규 저장/교체하고, 생략하면 기존 키 유지. 해당 provider 키가 없으면 400
- `POST /api/ai/test/:provider` → 저장된 키로 provider Models API 호출. 성공/실패를 `{ provider, ok }`로 반환하며 추론은 실행하지 않음
- `DELETE /api/ai/keys/:provider` → 해당 provider 키 삭제. 활성 provider 키도 삭제 가능하며 이때 `enabled=false`

## API Keys (Bearer 전용)

- `POST /api/keys` `{ name }` → 201 `{ id, name, key: "bm_<43자 base64url>", keyPrefix, createdAt }` — **`key` 원문은 이 응답에서만 노출**
- `GET /api/keys` → `{ items: [{ id, name, keyPrefix, lastUsedAt, createdAt }] }` (revoked 제외)
- `DELETE /api/keys/:id` — `revoked_at` 세팅 → 204

## Health

- `GET /api/health` → `{ ok: true }` (인증 없음, 컨테이너 헬스체크용)

## 레이트 리밋

API Key 인증 요청: 분당 60회/IP. 초과 시 429. Bearer 경로는 리밋 없음(1인 사용).

---

## iOS 단축어 레시피 (구현 후 사용자 안내용 — 그대로 문서화해 둘 것)

전제: 설정 화면에서 API Key 발급 (`bm_…` 복사).

### 레시피 A — AI 자동 분류

1. 단축어 앱 → 새 단축어 → 이름 "북마크 저장 (AI)"
2. 액션: **공유 시트에서 입력 받기** (URL/Safari 웹페이지 허용)
3. 액션: **URL 콘텐츠 가져오기**
   - URL: `https://<서버주소>/api/bookmarks`, 방법: POST
   - 헤더: `X-API-Key: bm_…`, `Content-Type: application/json`
   - 본문(JSON): `{ "url": "<단축어 입력>", "mode": "ai" }`
4. 액션: **알림 표시** — "저장됨" (409면 "이미 저장된 링크")
5. Safari 공유 시트에서 실행 → 저장과 동시에 AI가 백그라운드 분류

### 레시피 B — 수동 카테고리 선택

1~2. 위와 동일 (이름 "북마크 저장 (선택)")
3. 액션: **URL 콘텐츠 가져오기** — GET `https://<서버주소>/api/categories` (헤더 동일) → **목록에서 선택** 액션으로 카테고리 고르기 (항목: name, 값: id)
4. 액션: POST `/api/bookmarks` — 본문 `{ "url": "<입력>", "mode": "manual", "categoryId": "<선택된 id>" }`
5. 알림 표시

미지정 저장은 레시피 A에서 `"mode": "none"`으로만 바꾸면 된다.
