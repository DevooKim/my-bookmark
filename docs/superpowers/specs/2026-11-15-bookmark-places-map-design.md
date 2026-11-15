# 북마크 다중 장소 추출과 지도 마커 설계

## 배경

현재 AI 분석은 북마크 하나당 음식점 하나(`place`)만 반환하고, 여러 장소가 섞이면 `null`을 반환한다. 결과는 `metadata['네이버지도']` 검색 링크 하나로만 남는다.

2026-11-15 실데이터 조회 결과(북마크 370개): 맛집·여행지 카테고리 152개 중 지도 링크가 있는 것은 29개뿐이고, 링크가 없는 123개 중 약 103개(84%)가 "서촌 카페 6곳", "교토 맛집 4곳" 같은 다중 장소 게시물이었다. 또한 교토 등 해외 장소에도 네이버지도 링크가 붙어 쓸모가 없었다.

## 목표

1. **1단계 — 다중 장소 + 국내/해외 링크 분기**: 게시물 하나에서 여러 장소를 추출해 저장하고, 국내 장소는 네이버지도, 해외 장소는 구글맵 검색 링크로 연다.
2. **2단계 — 좌표와 지도 화면**: 국내 장소의 좌표를 네이버 지역 검색 API로 조회해 저장하고, 지도 화면에 마커로 표시한다. 마커는 **게시물(북마크) 단위로 묶인다** — A 게시물에 장소 3개가 있으면 그 3개 마커가 하나의 그룹이다. 마커에서 네이버지도를 열 수 있다.

두 단계는 별도 커밋 묶음으로 나눠 구현한다. 1단계만으로도 검증 루프를 통과해야 한다.

## 범위

### 포함

- AI 응답 `place`(단일) → `places`(배열) 전환, 국가 코드 추가, 음식점 한정 해제
- `bookmark_places` 테이블 (북마크 1 : 장소 N)
- 북마크 API 응답에 `places` 포함, 카드·상세에 장소 목록과 지도 링크 표시
- 네이버 지역 검색 API를 이용한 국내 장소 좌표 조회
- `/map` 지도 화면: 게시물별 마커 그룹, 마커 → 네이버지도 열기
- 기존 북마크용 장소 백필 스크립트

### 제외 (만들지 않는다)

- 구글 Places API 좌표 조회, 구글 지도 SDK — 해외 장소는 링크만 제공하고 마커는 없다
- 장소의 수동 추가·수정·삭제 UI
- 지도 화면 밖의 장소 검색(홈 목록 검색·MCP 검색에 장소를 포함하는 것), 마커 클러스터링, 길찾기
- 사진 EXIF GPS, 풍경으로 위치 추정
- 네이버지도 계정의 "저장" 연동(공개 API 없음)

## 데이터 모델

마이그레이션 파일을 `supabase migration new bookmark_places`로 생성한다. **원격 `supabase db push`는 에이전트가 실행하지 않는다** — 파일만 만들고 사용자 액션으로 보고한다.

```sql
create table public.bookmark_places (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  bookmark_id    uuid not null references public.bookmarks(id) on delete cascade,
  position       integer not null,            -- 게시물 안에서의 순서(0부터)
  name           text not null,               -- AI가 반환한 상호·장소명(원문 표기)
  locality       text,                        -- 동네·도시 단서
  country_code   text check (country_code ~ '^[A-Z]{2}$'),  -- ISO 3166-1 alpha-2, 모르면 null
  geocode_status text not null default 'pending'
                 check (geocode_status in ('pending','resolved','not_found','skipped')),
  lat            double precision,
  lng            double precision,
  address        text,                        -- 지역 검색 결과의 지번 주소
  road_address   text,                        -- 지역 검색 결과의 도로명 주소
  created_at     timestamptz not null default now(),
  unique (bookmark_id, position),
  check ((geocode_status = 'resolved') = (lat is not null and lng is not null))
);
create index bookmark_places_user_idx on public.bookmark_places (user_id);
create index bookmark_places_bookmark_idx on public.bookmark_places (bookmark_id);
```

- RLS는 기존 테이블과 같은 방식으로 켠다(다른 마이그레이션의 정책 패턴을 따른다). Express는 secret key로 접근하므로 **모든 쿼리에 `user_id` 필터를 명시**한다.
- `geocode_status` 의미:
  - `pending`: 좌표 조회 전(또는 네이버 검색 키 미설정)
  - `resolved`: 좌표 확보
  - `not_found`: 검색했지만 일치하는 결과 없음
  - `skipped`: 해외 장소라 조회 대상 아님
- 국내 판정: `country_code`가 `'KR'`이거나 `null`이면 국내로 취급한다(저장되는 게시물 대부분이 한국어·국내라 모를 때는 국내로 본다).

## AI 응답 변경 (`packages/ai`)

`place`를 제거하고 `places`로 교체한다.

```ts
export interface PlaceCandidate {
  name: string;               // 1~120자, 원문 표기 그대로
  locality: string | null;    // 1~120자
  countryCode: string | null; // ISO 3166-1 alpha-2 대문자, 불명확하면 null
  confidence: number;         // 0~1
}

export interface AnalyzeResult {
  // ...기존 필드
  places?: PlaceCandidate[] | null; // 최대 15개
}
```

- zod: `places`는 `z.array(...).max(15).nullable().optional()`. 항목 하나가 스키마에 어긋나도 분석 전체를 실패시키지 않도록, 배열 요소를 개별 `safeParse`해 통과한 것만 남기는 방식으로 파싱한다. 15개 초과분은 잘라낸다.
- strict `jsonSchema`: `places`는 `type: "array"`(빈 배열 허용), 항목의 모든 프로퍼티 required + nullable 규칙을 지킨다. `required` 목록의 `place`를 `places`로 바꾼다.
- 시스템 프롬프트의 13~15번 규칙을 다음 취지로 교체한다(문장은 다듬어도 되지만 의미는 유지):
  - 식당·카페·주점·매장·관광지·숙소·전시 공간 등 **방문 가능한 장소의 고유 이름**이 본문이나 이미지에 직접 확인될 때 `places`에 모두 넣는다. 게시물이 여러 장소를 소개하면 각각을 항목으로 넣는다(최대 15개, 본문 등장 순서).
  - 사진만 보고 이름을 추측하지 않는다. "서촌 카페", "교토 맛집"처럼 고유 이름이 아닌 일반 표현, 도시·동네·국가 자체는 넣지 않는다. 확인되는 장소가 없으면 빈 배열이다.
  - 지점명은 `name`에 포함한다. `name`은 원문 표기를 유지한다(해외 장소는 현지어·영문 표기 그대로). 확인 가능한 동네·도시는 `locality`에 넣는다.
  - `countryCode`는 장소가 있는 국가의 ISO 3166-1 alpha-2 코드다(한국 `KR`, 일본 `JP`). 본문 단서로 판단할 수 없으면 null이다.
- 태그 규칙(10번: 상호·지점명은 tags에서 제외)은 유지한다.

## 분류 파이프라인 변경 (`apps/api/src/services/categorize.ts`)

`applyCategorizeResult`에서:

1. `confidence >= 0.85`인 장소만 남긴다. `name`(공백·기호·대소문자 무시)이 같은 항목은 첫 번째만 남긴다.
2. `metadata['네이버지도']` 자동 생성은 **제거**한다. 기존 값이 `https://map.naver.com/p/search/`로 시작하면(=과거 자동 생성분) 재분석 시 해당 키를 metadata에서 삭제한다. 사용자가 직접 넣은 다른 값은 건드리지 않는다.
3. `markDone`이 성공해 북마크가 `done`으로 전이된 경우에만 장소를 교체한다: 해당 북마크의 기존 `bookmark_places` 행을 삭제하고 새 목록을 `position` 순으로 insert한다. 해외 장소는 `geocode_status='skipped'`, 국내는 `'pending'`으로 넣는다. (조건부 UPDATE가 0행이면 — 사용자가 그 사이 수동 편집 — 장소도 건드리지 않는다. `markDone`이 전이 여부를 알려주지 않으면 반환값을 추가한다.)
4. `removePlaceNameTags`는 남은 모든 장소 이름에 대해 적용한다.
5. 2단계: insert 직후 국내 `pending` 장소를 좌표 조회한다(아래). 좌표 조회 실패는 북마크 분석 결과에 영향을 주지 않는다 — `console.warn` 후 `pending`으로 둔다.

장소 저장·좌표 조회는 `services/bookmark-places.ts`(저장), `services/place-geocoder.ts`(네이버 호출)로 분리하고 `categorizeBookmark`에는 의존성으로 주입한다(기존 `imageLoader`, `recordUsage` 주입 패턴과 동일).

## 지도 링크 규칙 (`packages/shared`)

링크는 DB에 저장하지 않고 응답을 만들 때 계산한다. 순수 함수 `buildPlaceMapLink(place)`를 `packages/shared`에 두고 api가 응답 매핑에서 사용한다.

| 조건 | provider | URL |
|---|---|---|
| 국내 (`KR` 또는 null) | `naver` | `https://map.naver.com/p/search/{encodeURIComponent(query)}` |
| 해외 | `google` | `https://www.google.com/maps/search/?api=1&query={encodeURIComponent(query)}` |

`query`는 `[name, locality]`에서 빈 값을 빼고 공백으로 이은 문자열이다.

## API 변경

공유 스키마(`packages/shared`):

```ts
export const bookmarkPlaceSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  locality: z.string().nullable(),
  countryCode: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  address: z.string().nullable(),      // road_address 우선, 없으면 address
  mapProvider: z.enum(["naver", "google"]),
  mapUrl: z.url(),
});
```

- `bookmarkSchema`의 링크·이미지 양쪽에 `places: z.array(bookmarkPlaceSchema)`를 추가한다(`position` 오름차순). 목록·상세·생성·수정·MCP 응답 모두 같은 매퍼(`mapBookmark`)를 거치므로 한 곳에서 채운다. 목록 조회는 N+1이 되지 않게 한 번의 쿼리(PostgREST 임베드 또는 `in` 조회)로 가져온다. `search_bookmarks`/`semantic_search_bookmarks` RPC는 `setof bookmarks`를 반환하므로 RPC 결과에는 `in` 조회로 장소를 붙인다.
- 2단계 신규 엔드포인트 `GET /api/places` (Bearer 인증, API Key 허용 경로에 넣지 않음):

```jsonc
{
  "items": [
    {
      "bookmark": { "id": "…", "kind": "link", "title": "서촌 카페 6곳 추천", "url": "https://…", "thumbnailUrl": null },
      "places": [ /* bookmarkPlaceSchema, 좌표가 있는(resolved) 것만 */ ]
    }
  ]
}
```

  - 좌표가 있는 장소를 하나 이상 가진 북마크만, 북마크 `created_at` 내림차순으로 반환한다. 페이지네이션 없음(개인용 규모). `bookmark.title`은 null이면 북마크 목록과 같은 폴백을 쓴다. 이미지 북마크의 `thumbnailUrl`은 기존 이미지 목록과 같은 signed URL 생성 로직을 재사용한다.
  - 응답 스키마 `placeGroupsResponseSchema`를 `packages/shared`에 둔다.
- TanStack Query key: `['places']`. 북마크 생성·수정·삭제·재분류 mutation 성공 시 `['bookmarks']`와 함께 invalidate한다.
- `docs/03-api.md`에 위 내용을 반영한다.

## 좌표 조회 (2단계, `services/place-geocoder.ts`)

**NAVER API HUB(네이버 클라우드 플랫폼)의 지역 검색 API**를 사용한다. 네이버 개발자센터의 검색 API는 2026-07-31에 신규 발급이 종료되어(2026-11-15 등록 화면에서 '검색' 항목이 없음을 확인) `openapi.naver.com` + `X-Naver-Client-*` 방식은 새 키로 쓸 수 없다.

```
GET https://naverapihub.apigw.ntruss.com/search/v1/local?query={query}&display=5
X-NCP-APIGW-API-KEY-ID: {NAVER_SEARCH_CLIENT_ID}
X-NCP-APIGW-API-KEY: {NAVER_SEARCH_CLIENT_SECRET}
```

- **실측 확인(2026-11-15)**: 발급한 키로 위 요청이 HTTP 200을 반환했다. 응답은 `{ lastBuildDate, total, start, display, items[] }`이고 항목은 `title`(`<b>` 태그 포함), `link`, `category`, `description`, `telephone`, `address`, `roadAddress`, `mapx`, `mapy`다. `mapx`/`mapy`는 경도·위도에 10^7을 곱한 정수 문자열이다(예: `"1270284390"`, `"374977110"` → 경도 127.0284390, 위도 37.4977110). 한도는 일 25,000건, 월 775,000건(한시적 무료).
- 위 호스트·경로·헤더는 2차 자료(이관 안내 글)에서 가져와 실측으로 확인한 것이다. **구현 전에 NAVER API HUB 공식 문서(api.ncloud-docs.com의 NAVER API HUB > Search > 지역)에서 경로, 쿼리 파라미터(`format` 등), 응답 필드, 좌표 형식을 확인한다.** 기억에 의존하지 않는다. 설계 시점의 이해: `items[].title`(`<b>` 태그 포함 가능), `address`, `roadAddress`, `mapx`/`mapy`(WGS84 경도·위도에 10^7을 곱한 정수 문자열). 실제 키로 1회 호출해 좌표가 한국 범위(위도 33~39, 경도 124~132)로 변환되는지 확인하고, 다르면 문서 기준으로 고친다.
- 응답은 zod 스키마로 파싱한다. 타임아웃 5초.
- 매칭 규칙(오탐 방지 우선):
  1. `query = name + " " + locality`(locality 없으면 name만)로 검색한다.
  2. 결과의 `title`에서 태그를 제거하고, 공백·기호·대소문자를 무시한 정규화 문자열이 장소 `name`의 정규화 문자열을 **포함하거나 그 반대**인 첫 항목을 채택한다.
  3. 채택 항목이 없으면 `not_found`. name만으로 재검색하지 않는다(동명 매장 오탐).
- 채택 시 `lat`, `lng`, `address`, `road_address`, `geocode_status='resolved'`로 갱신한다.
- 요청은 순차 실행한다(초당 10회 제한 대비, 병렬 호출 금지).
- 키가 없으면 조회를 건너뛰고 `pending`으로 둔다. 서버 기동 시 경고 로그 1회. 키 누락이 서버 기동을 막지 않는다.
- 테스트는 fetch mock 기반. 실제 네트워크 테스트는 만들지 않는다.

### 환경변수

| 변수 | 위치 | 설명 |
|---|---|---|
| `NAVER_SEARCH_CLIENT_ID` | api | NAVER API HUB 애플리케이션 Client ID (optional) |
| `NAVER_SEARCH_CLIENT_SECRET` | api | 같은 애플리케이션의 Client Secret (optional, **서버 전용**) |
| `VITE_NAVER_MAP_CLIENT_ID` | web | 네이버 클라우드 플랫폼 Maps 인증 키 ID (브라우저 노출 가능) |

`.env.example`, `apps/api/src/lib/env.ts`, `docs/01-architecture.md`의 환경변수 목록에 추가한다. 실제 값은 설계 세션이 `.env`에 넣어 둔다 — **값을 출력하거나 로그·커밋에 남기지 않는다.**

## 백필 스크립트 (`apps/api/scripts/backfill-places.ts`)

기존 북마크는 재분석 없이는 장소가 없다. UI 재분류는 제목·요약·태그를 덮어쓰므로, 장소만 채우는 스크립트를 둔다(`backfill-embeddings.ts`의 구조를 따른다).

- 대상: `ai_status='done'`이고 `bookmark_places` 행이 없는 북마크. `--limit N`, `--dry-run` 지원.
- 링크는 메타데이터를 다시 fetch해 원문 제목·설명으로 `provider.categorize`를 호출하고, 이미지는 원본을 읽어 호출한다. 결과에서 **`places`만** 저장한다(제목·요약·태그·카테고리·임베딩은 건드리지 않음). 과거 자동 생성된 `metadata['네이버지도']` 키는 장소가 1개 이상 저장된 경우에만 삭제한다.
- 저장 후 좌표 조회까지 수행한다. 별도로 `--geocode-only` 옵션은 `pending` 장소의 좌표만 다시 조회한다.
- 실패는 건별로 격리하고 마지막에 요약(처리/장소 수/좌표 확보/실패)을 출력한다. 실패가 있으면 종료 코드 1.
- 스크립트 실행은 원격 DB에 쓰므로 에이전트가 실행하지 않는다. 사용자 액션으로 보고한다.

## 웹 UI

### 카드·상세의 장소 목록 (1단계)

- 북마크 카드와 이미지 상세에서 메타데이터 영역 근처에 장소 목록을 표시한다. 각 장소는 `MapPin` 아이콘 + 이름의 링크 칩이고, `mapUrl`을 새 탭으로 연다. 네이버 링크는 기존 `네이버지도` 메타데이터 링크의 호버 스타일(네이버 녹색)을 재사용하고, 구글 링크는 기본 링크 스타일을 쓴다.
- 카드에서는 최대 3개까지 보이고 나머지는 `+N`으로 접는다(누르면 펼침). 상세에서는 전부 보인다.
- 컴포넌트는 `-components/bookmark-places.tsx`로 분리한다.

### 지도 화면 `/map` (2단계)

- 라우트 `apps/web/src/routes/_authed/map.tsx`. 기존 내비게이션(리마인더·설정으로 가는 메뉴)에 "지도" 항목을 추가한다.
- 지도 SDK는 **네이버 지도 JavaScript API v3**를 `/map` 진입 시에만 스크립트 삽입으로 로드한다(초기 번들 예산 150KB 유지, 루트에 넣지 않는다). **스크립트 URL과 인증 파라미터 이름은 네이버 클라우드 플랫폼 공식 문서(https://navermaps.github.io/maps.js.ncp/ 및 NCP Maps 가이드)에서 현행 형식을 확인한다** — 파라미터 이름이 과거에 바뀐 적이 있다. 타입은 `@types/navermaps`(devDependency)를 쓰고 `any`로 우회하지 않는다.
- `VITE_NAVER_MAP_CLIENT_ID`가 없거나 SDK 로드·인증에 실패하면 지도 대신 안내 문구를 보여 주고, 아래 그룹 목록은 그대로 동작한다.
- 데이터: `GET /api/places` (`['places']`).
- **마커 그룹 = 게시물**:
  - 같은 북마크의 마커는 같은 색을 쓴다. 색은 고정 팔레트(8~10색)를 그룹 순서로 순환한다. 마커는 HTML 마커(색 원 + 그룹 내 순번 숫자)로 그린다.
  - 처음에는 전체 마커가 보이도록 `fitBounds`한다.
  - 마커나 목록의 게시물을 선택하면 그 그룹이 선택 상태가 된다: 그 그룹의 마커만 강조하고 나머지는 반투명으로 낮추며, 그룹 마커 전체가 보이도록 `fitBounds`한다. 선택 해제(지도 빈 곳 클릭 또는 닫기)하면 전체 보기로 돌아간다.
  - 선택 패널(데스크톱: 좌측 사이드 패널, 모바일: 하단 시트): 게시물 제목(누르면 원문 링크 또는 이미지 상세로 이동)과 그 게시물의 장소 목록. 장소 행을 누르면 해당 마커로 이동하고, 행의 "네이버지도" 버튼이 네이버지도를 연다.
  - 선택이 없을 때 패널에는 게시물 그룹 목록(제목 + 장소 수)이 보인다.
- **지도 검색** (사용자 요청 2026-11-15):
  - 패널 상단에 검색 입력을 둔다. 검색 대상은 세 가지다 — **게시글**(북마크 제목), **장소**(장소 이름), **지역**(`locality`, 주소). 하나의 입력으로 세 대상을 모두 검색한다.
  - `/api/places` 응답을 이미 전부 갖고 있으므로 **클라이언트에서 필터링**한다(서버 검색 엔드포인트를 만들지 않는다). 매칭은 대소문자·공백을 무시한 부분 일치다. 공백으로 나뉜 여러 단어는 모두 일치해야 한다(AND) — 단어마다 게시글 제목·장소 이름·지역 중 어디든 걸리면 된다. 예: "서촌 카페"는 지역이 서촌인 장소를 가진 "카페 6곳" 게시물을 찾는다.
  - 결과 규칙: 게시글 제목만으로 모든 단어가 일치하면 그 게시물의 장소 전부를 남긴다. 그렇지 않으면 장소 단위로 판정해(해당 장소의 이름·지역 + 소속 게시글 제목을 합친 텍스트에 모든 단어가 있는지) 일치한 장소만 남기고, 남은 장소가 없는 게시물은 뺀다.
  - 검색 중에는 지도 마커와 그룹 목록이 모두 결과로 좁혀지고, 결과 마커 전체가 보이도록 `fitBounds`한다. 그룹 색은 검색 전후로 바뀌지 않게 전체 목록 기준 순서로 고정한다. 결과가 없으면 "검색 결과가 없습니다"를 보여 준다. 입력을 지우면 전체 보기로 돌아간다.
  - 목록의 결과 항목에는 어떤 장소가 걸렸는지 알 수 있게 일치한 장소 이름과 지역을 함께 보여 준다.
  - 검색어는 URL 검색 파라미터 `q`에 반영한다(`/map?q=서촌`, zod 검증, 입력은 200ms 디바운스). 선택된 게시물이 결과에서 빠지면 선택을 해제한다.
  - 필터 로직은 순수 함수(`lib/place-search.ts`)로 분리하고 단위 테스트한다: 게시글 일치, 장소 일치, 지역 일치, 다중 단어 AND, 무결과.
- `/map?bookmark=<id>`로 진입하면 그 게시물 그룹을 선택한 상태로 연다. 검색 파라미터는 zod로 검증한다. 카드·상세의 장소 목록에 좌표가 있는 장소가 하나라도 있으면 "지도에서 보기" 링크를 둔다.
- **네이버지도 열기 규칙** (`lib/naver-map-link.ts`, 순수 함수 + 테스트):
  - 모바일(iOS/Android UA) + 좌표 있음: (2026-11-16 이후 `nmap://search?query=…`로 대체됨, docs/07-ui.md 참조) `nmap://place?lat={lat}&lng={lng}&name={encodeURIComponent(name)}&appname={location.host}`로 이동을 시도하고, 1.5초 뒤에도 문서가 보이는 상태(`document.visibilityState === 'visible'`)면 `mapUrl`(웹 검색 링크)을 연다.
  - 그 외: `mapUrl`을 새 탭으로 연다.
- 빈 상태: 좌표가 있는 장소가 없으면 "지도에 표시할 장소가 없습니다" 안내.
- 서비스 워커: `/api/places`는 기존 API 캐시 정책을 따른다. 지도 SDK·타일 요청(네이버 도메인)은 서비스 워커가 가로채지 않는지 확인한다.
- `docs/07-ui.md`에 반영한다.

## 테스트

- `packages/ai`: `places` 파싱(여러 개, 빈 배열, null, 항목 일부 불량, 15개 초과), jsonSchema required 목록.
- `packages/shared`: `buildPlaceMapLink`(국내/해외/null 국가/locality 없음), 스키마.
- `apps/api`: 파이프라인 — 신뢰도 필터, 이름 중복 제거, 재분석 시 교체, 수동 편집으로 pending이 아닐 때 장소 미변경, 과거 `네이버지도` 메타데이터 정리, 태그에서 장소명 제거. 좌표 조회 — 매칭 채택/불일치 `not_found`/해외 `skipped`/키 없음/네트워크 오류. `GET /api/places` — 사용자 경계, 좌표 없는 장소 제외, 그룹 구조.
- `apps/web`: 장소 칩 렌더·접기, `naver-map-link` 분기, `/map`의 그룹 선택 상태(지도 SDK는 얇은 어댑터 뒤에 두고 테스트에서는 fake로 대체).
- 기존 테스트 중 `place`·`네이버지도` 메타데이터를 기대하는 것은 새 동작에 맞게 고친다(skip 금지).

## 문서 갱신

구현과 함께 `docs/02-database.md`, `docs/03-api.md`, `docs/05-ai.md`, `docs/07-ui.md`, `docs/01-architecture.md`(환경변수)를 갱신하고, `PROGRESS.md`에 체크리스트 항목·결정 로그·사용자 액션(마이그레이션 push, 백필 실행)을 기록한다.

## 수용 기준

1. `bun run typecheck && bun run lint && bun run test && bun run build` 통과.
2. 다중 장소 게시물 분석 결과가 `bookmark_places`에 여러 행으로 저장되고, 응답 `places`에 순서대로 나온다.
3. 국내 장소 링크는 네이버지도, 해외 장소 링크는 구글맵으로 열린다.
4. 국내 장소는 좌표가 채워지고(`resolved`), 일치 결과가 없으면 `not_found`, 해외는 `skipped`다.
5. `/map`에서 같은 게시물의 마커가 같은 색·그룹으로 묶이고, 게시물 선택 시 그 그룹만 강조된다.
6. 마커(또는 장소 행)에서 네이버지도가 열린다.
6-1. `/map` 검색창에서 게시글 제목, 장소 이름, 지역으로 검색하면 마커와 목록이 결과로 좁혀진다.
7. 초기 라우트 JS 예산(150KB gzip)을 넘기지 않는다 — 지도 코드는 `/map` 청크에만 있다.
