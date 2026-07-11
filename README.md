# my-bookmark

개인용 북마크 관리 웹서비스. 링크를 저장하면 AI가 카테고리를 자동 분류하고, PWA로 설치해 모바일에서 쓰며, iOS 단축어로 바로 등록하고, 특정 시간에 푸시 리마인더를 받을 수 있다.

**1인 사용 서비스** — Supabase Auth(가입 차단) + API Key로 외부 접근을 막는다.

## 상태

Phase 0~7과 AI 설정 후속 기능 구현을 완료했다. 현재 배포 설정을 정리하고 있다.

## 문서

| 문서 | 내용 |
|---|---|
| [CLAUDE.md](./CLAUDE.md) | 에이전트(Claude) 작업 지침 — 모든 세션의 출발점 |
| [docs/00-overview.md](./docs/00-overview.md) | 요구사항 ↔ 해법 매핑, 결정 로그 |
| [docs/01-architecture.md](./docs/01-architecture.md) | 아키텍처, 모노레포 구조, 환경변수 |
| [docs/02-database.md](./docs/02-database.md) | DB 스키마, RLS, 마이그레이션 |
| [docs/03-api.md](./docs/03-api.md) | REST API 스펙, 단축어 레시피 |
| [docs/04-auth.md](./docs/04-auth.md) | 인증 설계 (Supabase Auth + API Key) |
| [docs/05-ai.md](./docs/05-ai.md) | AI provider 인터페이스, 분류 파이프라인 |
| [docs/06-pwa-push.md](./docs/06-pwa-push.md) | PWA, Web Push 기술 설명과 구현 |
| [docs/07-ui.md](./docs/07-ui.md) | UI/UX 명세, 디자인 시스템 |
| [docs/08-performance.md](./docs/08-performance.md) | 성능 최적화 체크리스트 |
| [docs/09-roadmap.md](./docs/09-roadmap.md) | Phase 0~7 구현 로드맵 |
| [PROGRESS.md](./PROGRESS.md) | 구현 진행 로그 (에이전트가 갱신) |

## 기술 스택

Bun workspaces · TanStack Start(React) · Express 5 · Supabase (Postgres/Auth) · Tailwind CSS v4 · Web Push · Vercel · Docker · Node.js 24 LTS
