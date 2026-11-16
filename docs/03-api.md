# 03. API 스펙 (Go)

Base URL: `{API_URL}/api`. 이미지 업로드만 `multipart/form-data`이고 나머지 요청/응답은 JSON이다. 시간은 ISO 8601(UTC).

## 인증

두 방식 중 하나. 인증 미들웨어가 요청 컨텍스트에 사용자 ID를 설정한다.

| 방식 | 헤더 | 대상 |
|---|---|---|
| Supabase 세션 | `Authorization: Bearer <access_token>` | 웹앱 |
| API Key | `X-API-Key: bm_…` | iOS 단축어, 스크립트 |

- API Key는 북마크·카테고리·이미지·공유 API와 MCP에서 허용한다. 키 관리·푸시·리마인더·장소·AI는 Bearer 전용이다.
- `GET /api/health`와 `GET /api/health/ready`는 인증이 필요 없다.

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
| 413 | `VALIDATION_ERROR` (20MB 초과 이미지) |
| 415 | `VALIDATION_ERROR` (지원하지 않는 이미지 형식) |
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

응답 201: `{ "bookmark": { …전체 필드, "kind": "link", "url": "https://…", "image": null, "tags": ["React", "프론트엔드"], "metadata": {} } }`. `tags`는 최대 5개의 문자열 배열이다. `metadata`는 최대 10개의 문자열 key-value 객체이며 URL 값도 문자열로 반환한다. `aiModel`은 AI가 분류에 실사용한 OpenRouter 모델 id(raw, 미분류/미시도면 `null`)다. `places`는 AI가 추출한 장소 배열(`position` 오름차순, 없으면 `[]`)이다. 단축어는 이 응답의 `bookmark.title`을 알림 표시에 활용 가능.

#### 응답의 `places`

링크·이미지 북마크 모두 목록·상세·생성·수정·MCP 응답에 `places`가 포함된다. 목록과 시맨틱 검색은 장소를 `in` 조회 한 번으로 붙인다(N+1 없음).

```json
{ "id": "…", "name": "호랑이식당 성수점", "locality": "서울 성동구", "countryCode": "KR",
  "lat": 37.54, "lng": 127.05, "address": "서울 성동구 …", "mapProvider": "naver", "mapUrl": "https://map.naver.com/p/search/…" }
```

- `address`는 도로명 주소가 있으면 그것, 없으면 지번 주소다. 좌표가 없으면 `lat`/`lng`는 `null`.
- 지도 링크는 DB에 저장하지 않고 응답 시점에 계산한다. `query`는 `[name, locality]`에서 빈 값을 뺀 뒤 공백으로 이은 문자열이다.

| 조건 | `mapProvider` | `mapUrl` |
|---|---|---|
| 국내(`countryCode`가 `KR` 또는 `null`) | `naver` | `https://map.naver.com/p/search/{encodeURIComponent(query)}` |
| 해외 | `google` | `https://www.google.com/maps/search/?api=1&query={encodeURIComponent(query)}` |

### POST /api/images — 이미지 등록·자동 분석 (웹 + 단축어 공용)

- `Content-Type: multipart/form-data`, 파일 필드 이름은 `image`, 요청당 파일 1개다. 여러 장은 각 파일을 별도 요청으로 보낸다.
- 허용 형식: JPEG, PNG, WebP, GIF, HEIC/HEIF. 파일당 최대 20MB, 디코딩 픽셀 상한 64MP. HEIC/HEIF는 런타임의 native libheif 유무에 의존하지 않도록 `heic-decode`로 디코딩한 뒤 Sharp로 썸네일과 AI 입력을 만든다.
- 원본은 그대로 private Supabase Storage `bookmark-images` 버킷에 저장한다. EXIF 방향을 적용한 640px WebP 썸네일과 최대 2048px JPEG 분석 입력을 서버에서 생성한다.
- DB 행과 썸네일을 저장한 뒤 `aiStatus: "pending"`인 이미지 항목을 201로 즉시 반환하고, 제목·요약·태그·카테고리 분석은 백그라운드에서 자동 실행한다. 이미지 등록에는 `mode`가 없다.
- AI 입력용 변환 이미지는 영구 저장하지 않고, OCR 원문도 추출·저장·검색하지 않는다.
- 응답의 `kind`는 `"image"`, `url`은 `null`이다. `image`에는 `thumbnailUrl`, `originalUrl`, `mimeType`, `fileSize`, `width`, `height`, `filename`이 있으며 목록/생성 응답의 `originalUrl`은 `null`이다. 상세 조회에서만 짧은 수명의 signed 원본 URL을 반환한다.
- Storage 저장 후 DB insert가 실패하면 업로드 파일을 정리한다. 삭제 시에는 private Storage 원본·썸네일을 먼저 삭제하고 DB 행을 삭제한다.
- 웹/PWA는 파일 선택·드롭·붙여넣기 단계에서 로컬 미리보기만 만들고, 사용자가 `이미지 저장`을 눌렀을 때 파일별 요청과 AI 분석을 시작한다. 상세 화면은 signed 썸네일을 기본 미리보기로 사용하고 `원본 보기`를 눌렀을 때만 signed 원본과 다운로드를 노출한다.

### POST /api/share — iOS 단축어 통합 등록

- 필드 이름은 `item`이고 요청당 링크 텍스트 또는 이미지 파일 하나를 받는다. 링크 폼은 iOS 단축어가 보내는 `application/x-www-form-urlencoded`와 multipart 텍스트를 모두 허용하며, 이미지 파일은 `multipart/form-data`로 받는다.
- `X-API-Key: bm_…` 또는 Bearer JWT 인증을 허용한다.
- 링크 텍스트는 기존 `/api/bookmarks`의 `mode=ai`로 등록하고, 이미지 파일은 기존 `/api/images`와 같은 검증·Storage 저장·AI 분석을 수행한다.
- 텍스트와 파일이 동시에 들어오거나 둘 다 없으면 400을 반환한다. 여러 항목은 iOS 단축어의 `각 항목 반복`으로 각각 요청한다.
- 성공/오류 응답은 기존 링크·이미지 등록 API와 같다. 기존 두 엔드포인트도 계속 지원한다.

### GET /api/bookmarks — 목록

쿼리: `categoryId` (uuid | `none`=미분류 | 생략=전체), `kind` (`link` | `image` | 생략=전체), `q` (title/url/description/tags 부분 검색), `cursor`, `limit` (기본 30, 최대 100). 태그 클릭 검색도 별도 쿼리 없이 기존 `q`를 사용한다.

```json
{ "items": [ … ], "nextCursor": "base64(created_at|id)" }
```

keyset 페이지네이션: `(created_at, id) < cursor` order by `created_at desc, id desc`.

### GET /api/places — 지도용 장소 그룹 (Bearer 전용)

API Key 허용 경로가 아니다. 좌표가 있는(`geocode_status='resolved'`) 장소를 하나 이상 가진 북마크만 북마크 `created_at` 내림차순으로 반환한다. 페이지네이션은 없다(개인용 규모). `bookmark.title`이 없으면 북마크 목록과 같은 폴백(링크는 호스트명, 이미지는 파일명)을 쓴다. 이미지 북마크의 `thumbnailUrl`은 기존 이미지 목록과 같은 signed URL이며 서명 실패 시 `null`이다.

```json
{ "items": [ { "bookmark": { "id": "…", "kind": "link", "title": "서촌 카페 6곳 추천", "url": "https://…", "thumbnailUrl": null },
               "places": [ /* 응답의 places 형식, 좌표가 있는 것만, position 순 */ ] } ] }
```

서비스 워커는 이 응답을 캐시하지 않는다(network-only).

### GET /api/bookmarks/search/semantic — 의미 검색

쿼리: `q` (필수, 공백 trim 후 1자 이상), `limit` (기본 20, 최대 100).
제목·설명·태그로 쿼리를 임베딩한 뒤 pgvector RPC를 호출하며, 코사인 거리 임계값은 초기값 `0.6`이다. RPC가 반환하는 행에는 거리가 포함되지 않으므로 응답에도 거리를 노출하지 않는다.

```json
{ "items": [ … ], "nextCursor": null }
```

시맨틱 검색 provider가 설정되지 않으면 500 + `INTERNAL` 에러를 반환한다. 기존 `GET /api/bookmarks`의 부분일치 검색과 웹 검색창은 변경하지 않는다.

### 기타

- `GET /api/bookmarks/:id` → `{ bookmark }`. 이미지 항목은 signed 썸네일·원본 URL을 포함한다.
- `PATCH /api/bookmarks/:id` — `title`, `description`, `categoryId`(null 허용=미분류로), `url`, `tags`, `metadata` 수정. `url` 변경은 링크 항목에서만 허용한다. `tags`는 공백을 trim하고 중복을 제거하며 최대 5개, 각 20자 이하다. `metadata`는 전달 시 전체 객체를 교체하고 `{}`는 전체 삭제다. key/value를 trim하며 최대 10개, key 40자, value 2048자 이하다. 사용자가 이 필드 중 하나라도 수정하면 서버가 `ai_status='idle'`로 되돌려 pending AI 결과가 수동 편집을 덮어쓰지 못하게 한다.
- `DELETE /api/bookmarks/:id` → 204. 이미지 항목은 private Storage 원본·썸네일도 삭제한다.
- `POST /api/bookmarks/:id/categorize` — AI 재분류 트리거 (`ai_status='pending'`으로 바꾸고 202 반환, 백그라운드 실행). `pending` 중이면 409

## Categories

카테고리는 색상 없이 이름 문자열 하나로 표현한다(AI가 신규 카테고리를 만들 때 "이모지 + 텍스트" 형식으로 이름을 짓는다 — 05-ai 참조).

- `GET /api/categories?withCounts=true` → `{ items: [{ id, name, sortOrder, bookmarkCount? }] }` (이름순 아닌 `sort_order, created_at` 순)
- `POST /api/categories` `{ name }` → 201. 이름 중복 409
- `PATCH /api/categories/:id` `{ name? }`
- `PUT /api/categories/order` `{ ids: uuid[] }` → 사용자의 전체 카테고리 id를 정확히 한 번씩 포함한 배열이어야 한다(배열 순서 = `sort_order`). 누락/중복/미상 id는 400. 응답 `{ items }`(재정렬된 목록)
- `DELETE /api/categories/:id` → 204 (소속 북마크는 미분류로)

## Reminders (Bearer 전용)

- `POST /api/reminders` `{ bookmarkId, remindAt, note?, recurrence, recurrenceTimezone }` → 201. 반복은 `none | daily | weekly | monthly`; 과거 시각이나 잘못된 IANA timezone은 400
- `GET /api/reminders` → `{ items: [ …, recurrence, recurrenceTimezone, isEnabled, bookmark: { id, kind, title, url } ] }` (`cancelled` 제외, `remind_at` asc). 발송된 단발과 비활성 반복도 이력으로 반환하며 이미지 알림은 웹 내부 `/images/:id` 상세 화면을 연다.
- `PATCH /api/reminders/:id` `{ remindAt?, note?, recurrence?, recurrenceTimezone?, isEnabled? }` — pending만 수정 가능. 반복 재활성화 시 지난 회차를 건너뛰고 다음 미래 시각으로 이동
- `POST /api/reminders/:id/reschedule` `{ remindAt, note?, recurrence, recurrenceTimezone }` — 발송된 단발 행을 같은 id의 pending 일정으로 다시 설정
- `DELETE /api/reminders/:id` — pending/sent 모두 실삭제 대신 `status='cancelled'` → 204

## Push (Bearer 전용)

- `POST /api/push/subscriptions` — body는 `PushSubscription.toJSON()` 그대로: `{ endpoint, keys: { p256dh, auth } }`. upsert(endpoint 기준) → 201
- `POST /api/push/unsubscribe` `{ endpoint }` → 204
- `POST /api/push/test` — 이 사용자의 모든 구독에 테스트 알림 발송 → `{ sent: n, failed: n }` (푸시 설정 검증용)

## AI (Bearer 전용)

AI 분류는 OpenRouter 단일 호출(요청의 `models` 배열로 폴백)로 동작한다. 키는 서버 env `OPEN_ROUTER_API_KEY`, 모델·폴백 순서는 선택 env `OPEN_ROUTER_MODELS`이며, provider별 키 관리 API는 없다(05-ai 참조). `GET /api/ai`의 `preset`은 표시용 라벨이다.

- `GET /api/ai` → `{ enabled, preset }`. `enabled`는 서버에 `OPEN_ROUTER_API_KEY`가 설정돼 있는지, `preset`은 `"@preset/my-bookmark"` 고정값
- `POST /api/ai/test` → 저장된 키로 OpenRouter `GET /key`를 호출해 유효성만 확인. `{ ok }` 반환, 추론은 실행하지 않음
- `GET /api/ai/usage?days=` (기본 30, 최대 90) → 이 사용자의 최근 분류 시도 이벤트 원본 목록(최대 1000행, `created_at desc`). `{ days, items: [{ id, provider, model, bookmarkId, status, errorCode, durationMs, isByok, createdAt }] }`. 집계(모델별/일별)는 클라이언트가 수행
- `GET /api/ai/account` → OpenRouter 계정 사용액(`GET /key` 프록시): `{ usage, usageDaily, usageWeekly, usageMonthly, limit, limitRemaining, isFreeTier }` (USD). `OPEN_ROUTER_API_KEY` 미설정 시 400
- `GET /api/ai/analytics?days=` (기본 30, 최대 90) → OpenRouter Analytics API 프록시(모델별·일별): `{ days, configured, rows: [{ date, model, usage, tokens, requests }] }`. `OPEN_ROUTER_MANAGEMENT_KEY` 미설정 시 `configured: false`에 빈 rows(에러 아님)

## API Keys (Bearer 전용)

- `POST /api/keys` `{ name }` → 201 `{ id, name, key: "bm_<43자 base64url>", keyPrefix, createdAt }` — **`key` 원문은 이 응답에서만 노출**
- `GET /api/keys` → `{ items: [{ id, name, keyPrefix, lastUsedAt, createdAt }] }` (revoked 제외)
- `DELETE /api/keys/:id` — `revoked_at` 세팅 → 204

## Health

- `GET /api/health` → `{ ok: true }` (인증 없음, 컨테이너 헬스체크용)

## 레이트 리밋

API Key 인증 요청(`bookmarks`, `images`, `share`, `categories`): 분당 60회/IP. 초과 시 429. Bearer 경로는 리밋 없음(1인 사용).

---

## iOS 단축어 레시피 (구현 후 사용자 안내용 — 그대로 문서화해 둘 것)

전제: 설정 화면에서 API Key 발급 (`bm_…` 복사).

### 권장 레시피 — 링크와 이미지 통합 저장

1. 단축어 앱 → 새 단축어 → 이름 `북마크 저장`
2. 공유 시트 입력 유형에서 URL, Safari 웹페이지, 이미지를 허용
3. `각 항목 반복` 안에서 현재 항목의 유형을 확인
4. URL이면 텍스트 폼 `item=<추출한 URL>`, 이미지면 파일 폼 `item=<현재 이미지>`로 `POST https://<서버주소>/api/share` 호출
5. 헤더는 `X-API-Key: bm_…`만 설정하고 `Content-Type`은 단축어가 생성하게 함
6. 반복 종료 후 성공·실패 건수 알림 표시

아래 분리 레시피는 기존 단축어 호환용으로 유지한다.

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

### 레시피 C — 이미지 자동 분석

1. 공유 시트 입력 유형을 이미지로 제한하고 **각 항목 반복**을 추가한다.
2. 반복문 안에서 `POST https://<서버주소>/api/images`, 헤더 `X-API-Key: bm_…`를 설정한다.
3. 본문은 폼 필드 `image`에 현재 반복 항목을 넣는다. multipart `Content-Type`은 단축어가 자동 생성하므로 직접 지정하지 않는다.
4. 각 201/실패 결과를 집계해 마지막에 성공·실패 장수를 알린다. 상세 설정과 키 노출 주의사항은 `docs/shortcuts-guide.md`를 따른다.
