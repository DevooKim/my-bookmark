# 08. 성능 최적화

원칙: **측정 → 최적화**. 추측으로 최적화하지 않는다. 1인 서비스이므로 서버 스케일링이 아니라 **모바일 체감 속도**(초기 로드, 인터랙션 반응)가 전부다.

## 목표 수치

| 지표 | 목표 | 측정 방법 |
|---|---|---|
| Lighthouse Performance (모바일, 프로덕션 빌드) | ≥ 90 | `bunx lighthouse` 또는 Chrome DevTools |
| LCP | < 2.5s | 〃 |
| 초기 라우트 JS (gzip) | < 150KB | `vite build` 출력 + `du` |
| 북마크 1,000개에서 홈 스크롤 | 60fps 체감, 프리징 없음 | DevTools Performance |
| API 목록 응답 (p95) | < 150ms | 서버 로그 |

## 프론트엔드

### 번들
- 라우트 기반 코드 스플리팅: TanStack Router가 자동 처리 — 라우트 파일에서 무거운 것을 직접 import하지 않으면 된다.
- 다이얼로그류(추가, 리마인더 피커)는 `lazy` + 열릴 때 로드.
- 금지: moment/lodash 전체 import, 웹폰트, 차트/에디터 등 무거운 의존성. 날짜 포맷은 `Intl.RelativeTimeFormat`/`Intl.DateTimeFormat` 직접 사용 (라이브러리 불필요).
- 빌드 후 `vite build`의 청크 리포트를 확인하고 100KB 넘는 청크는 원인 파악.

### 데이터/렌더
- TanStack Query: `staleTime: 30_000` 기본 (즉시 재요청 방지), 목록은 `useInfiniteQuery` + keyset cursor.
- 링크/탭에 Router `preload="intent"` (hover/터치 시작 시 프리로드).
- 목록이 100개 초과 렌더될 때 TanStack Virtual 적용. 그 전엔 넣지 않는다 (수용 기준: 1,000개 시나리오는 Phase 7에서 시드 스크립트로 검증).
- 검색 입력 300ms debounce. `ai_status=pending` 폴링은 pending 항목이 있을 때만 (07-ui).
- 이미지: favicon/og 이미지는 `loading="lazy"` + 고정 크기 컨테이너(CLS 방지) + `onerror` 폴백 아이콘.

### 로컬 우선 표시 (IndexedDB 쿼리 캐시 영속화)
- `apps/web/src/lib/query-persist.ts`: TanStack Query 캐시를 IndexedDB(`my-bookmark` DB / `query-cache` store)에 저장하고, `_authed` 레이아웃이 세션 확인과 병렬로 복원한다. 첫 렌더에 마지막 목록이 보이고, staleTime이 지난 쿼리는 백그라운드에서 refetch된다.
- 영속 대상: `['bookmarks', filters]`(검색어 `q`가 있는 키 제외), `['categories']`, `['reminders']`. 성공 상태만. mutation은 저장하지 않는다(쓰기는 온라인 전용).
- 무한 목록은 첫 페이지만 저장(복원 후 refetch가 로드된 페이지 수만큼 순차 요청하는 것 방지). 저장은 1초 단위로 합친다.
- `maxAge`/영속 키 `gcTime`은 7일. buster는 빌드마다 바뀌는 `__BUILD_ID__`(vite `define`) — 배포 후 첫 실행은 캐시 없이 시작해 응답 스키마 드리프트를 막는다.
- 로그아웃 시 구독 해제 후 스냅샷 삭제. 이미지 썸네일은 10분짜리 signed URL이라 복원 직후 만료될 수 있어 로드 실패 시 placeholder로 대체하고 refetch가 새 URL로 교체한다.

### 서비스 워커 캐싱 (06-pwa-push의 SW에 구현)
- `/assets/*` (해시된 정적 자산): cache-first (immutable이므로 안전).
- `GET /api/bookmarks`, `GET /api/categories`: network-first, 성공 응답을 캐시에 복사 → 오프라인에서 마지막 목록 읽기 가능.
- **그 외 `/api/*`는 절대 캐시하지 않는다** (mutation, 인증 관련 사고 방지). HTML 내비게이션도 network 우선.

## 백엔드 (Go)

- 이미지 처리는 libvips를 사용하며 업로드 크기와 디코딩 픽셀 수를 제한한다.
- 목록 쿼리는 인덱스를 타는 keyset 페이지네이션 (02-database의 `bookmarks_user_created_idx`).
- `withCounts=true` 카테고리 집계는 단일 쿼리(group by)로 — 카테고리별 N+1 금지.
- 메타데이터 fetch/AI 분류는 요청 경로 밖(백그라운드) — 등록 응답을 절대 막지 않는다 (05-ai).
- 운영 알림과 오류 로그에는 인증 정보와 비밀값을 남기지 않는다.

## 웹 서버/전송

- TanStack Start SSR 산출물의 Node 서버 사용. 정적 자산 캐시 헤더: `/assets/*`는 `max-age=31536000, immutable`, 해시 없는 고정 URL `/assets/app-styles.css`는 `no-cache`(매번 ETag 재검증, 변경 없으면 304 — 배포 직후 새 CSS가 즉시 적용되도록; 과거 `max-age=3600`은 최대 1시간 옛 CSS를 내보냈다), `sw.js`는 `no-cache` (업데이트 즉시 반영), manifest/아이콘은 `max-age=3600`.
- 배포 시 리버스 프록시(Caddy)에서 HTTP/2 + TLS. (HTTPS는 PWA 필수이기도 함)

## 검증 절차 (Phase 7 수용 기준과 연동)

1. `bun run build` → 프로덕션 모드로 기동 (`docker compose up`)
2. 시드 스크립트로 북마크 1,000개 삽입 → 홈 스크롤/검색/필터 체감 확인
3. Lighthouse 모바일 프리셋 실행 → 90 미만이면 리포트의 상위 항목부터 수정
4. 결과 수치를 PROGRESS.md에 기록
