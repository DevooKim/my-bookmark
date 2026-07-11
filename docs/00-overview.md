# 00. 개요 — 요구사항과 해법

## 서비스 한 줄 요약

1인용 북마크 관리 서비스. 링크 저장 → AI 카테고리 분류(선택) → 카테고리별 열람 → 리마인더 푸시. PWA + iOS 단축어 지원.

## 요구사항 ↔ 해법 매핑

| # | 요구사항 | 해법 | 상세 문서 |
|---|---|---|---|
| 1 | 외부 접근 차단 (1인 사용) | Supabase Auth 이메일+비밀번호, **신규 가입 차단**, 계정 1개 수동 생성. 단축어용은 별도 API Key (`X-API-Key`) | 04-auth |
| 2 | 카테고리별 링크 표시 | `categories` 테이블 + 홈 화면 카테고리 칩 필터. 미분류는 `category_id IS NULL` | 02-database, 07-ui |
| 3 | 등록 시 AI 분석 / 수동 지정 / 미지정 선택 | `POST /api/bookmarks`의 `mode: 'ai' \| 'manual' \| 'none'`. AI는 비동기 처리(즉시 201, 백그라운드 분류) | 03-api, 05-ai |
| 4 | PWA, 모바일 지원 | Web App Manifest + Service Worker + 모바일 퍼스트 UI(하단 탭). 홈 화면 설치 가능 | 06-pwa-push, 07-ui |
| 5 | 아이폰 단축어 등록 API (AI/수동) | API Key 인증으로 같은 `POST /api/bookmarks` 사용. 단축어 레시피 2종 문서화 | 03-api |
| 6 | 심플·모던 UI | Tailwind v4 + 최소 디자인 토큰, 다크모드, shadcn/ui 스타일 컴포넌트 | 07-ui |
| 7 | 알림(리마인더) 기능 | `reminders` 테이블 + node-cron 스케줄러 + Web Push 발송. 상세 기능(반복 등)은 추후 확장 | 06-pwa-push |
| 8 | PWA 알림에 필요한 기술 | Service Worker + Push API + Web Push(VAPID). iOS는 16.4+ 홈 화면 설치 필수 | 06-pwa-push |
| 9 | 웹/성능 최적화 | 코드 스플리팅, Query 캐싱, TanStack Virtual, SW 캐싱, Lighthouse 90+ 목표 | 08-performance |
| 10 | AI 멀티 provider 인터페이스 | `packages/ai`의 `AiProvider` 인터페이스. Gemini 기본, Anthropic/OpenAI 구현. env로 전환 | 05-ai |
| 11 | TanStack 적극 사용 | TanStack Start(프레임워크) + Router + Query + Form + Virtual | 01-architecture |

## 결정 로그

| 날짜 | 결정 | 이유 |
|---|---|---|
| 2026-07-06 | 접근 제어: Supabase Auth + 가입 차단 (사용자 선택) | 구현 비용 최소, RLS 연동 자연스러움, PWA 세션 안정. Passkey는 Supabase 미지원으로 비용 큼 |
| 2026-07-06 | 배포: 미정 — Docker Compose로 이식성 확보 (사용자 선택) | 홈서버/VPS/PaaS 어디든 이동 가능. 리마인더 스케줄러 때문에 상시 실행 프로세스 필요 → 서버리스 배제 |
| 2026-07-11 | AI 기본 provider: Gemini. Anthropic/OpenAI도 구현 (사용자 선택) | 인터페이스로 추상화하고 설정 화면에서 provider 및 암호화 API 키 관리 |
| 2026-07-06 | 데이터 경로: 웹도 CRUD는 전부 Express 경유 (단일 API 표면) | 웹/단축어가 같은 API 사용 → 로직 중복 없음, 검증·AI·푸시가 서버 한 곳에 모임. RLS는 심층 방어로 유지 |
| 2026-07-06 | AI 분류는 비동기 (등록 즉시 201 → 백그라운드 분류) | 단축어 응답 속도 확보, AI 장애가 등록을 막지 않음. 1인용이라 큐 없이 in-process로 충분 |
| 2026-07-06 | 서비스 워커: vite-plugin-pwa 대신 수동 SW + 별도 esbuild | vite-plugin-pwa가 TanStack Start 프로덕션 빌드와 비호환 (TanStack/router#4988) |
| 2026-07-06 | 미분류 = `category_id NULL` (별도 "미분류" 카테고리 행 없음) | 특수 행의 삭제/이름변경 방어 코드가 불필요해짐 |
| 2026-07-06 | 린터: Biome (ESLint 아님) | 단일 도구로 lint+format, 설정 단순, 속도 |

새 결정이 생기면 이 표가 아니라 `PROGRESS.md`의 결정 로그에 기록한다 (이 문서는 초기 설계 스냅샷).

## 명시적 비범위 (지금 만들지 않는 것)

- 다중 사용자/공유 기능 (스키마는 `user_id`로 대비만 해둠)
- 반복 리마인더, 알림 상세 설정 (요구사항 7 — "상세 기능은 추후")
- 브라우저 확장, 북마크 가져오기/내보내기
- 전문 검색(pg trigram/FTS) — 초기엔 `ilike`로 충분
- 오프라인 쓰기(쓰기 큐) — 오프라인은 읽기 캐시까지만
