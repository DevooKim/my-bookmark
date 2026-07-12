---
name: verify-app
description: my-bookmark 전체 검증 — 정적 검사, 빌드, 테스트, 기동 확인, 완료된 Phase들의 핵심 동작 회귀 확인. Phase 완료 후, 리팩터링 후, 배포 전에 사용.
---

# 전체 검증 워크플로우

결과를 있는 그대로 보고하는 것이 목적이다. **실패를 축소하거나 "대체로 통과"로 뭉뚱그리지 않는다.**

## 1. 정적 검사 + 빌드

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

각 명령의 성공/실패와 실패 시 원문 에러를 기록.

## 2. 기동 확인

- `pnpm dev` 백그라운드 기동 → web(:3000) HTML 응답, `curl localhost:3001/api/health` → `{"ok":true}`.
- api 프로덕션 산출물: `node apps/api/dist/index.js` 기동 확인 (env 필요 시 .env 로드).
- 콘솔에 unhandled rejection / 에러 로그가 없는지 확인.

## 3. 기능 회귀 (완료된 Phase만 해당 항목 수행)

PROGRESS.md에서 완료된 Phase를 확인하고, 각 Phase의 수용 기준 중 자동 확인 가능한 것을 curl/브라우저 도구로 점검한다. 최소 체크리스트:

- [ ] (P1) 무토큰 `GET /api/me` → 401. 로그인 → 홈 진입
- [ ] (P2) 북마크 등록 → 목록 반영, 중복 409, 카테고리 필터/검색
- [ ] (P3) mode=ai 등록 → ai_status 전이 (pending → done/failed)
- [ ] (P4) X-API-Key로 등록 성공, 회수된 키 401, 키로 /api/keys 접근 401
- [ ] (P5) 프로덕션 빌드에 sw.js 존재, manifest 유효
- [ ] (P6) POST /api/push/test 응답 정상 (실수신은 사용자 확인 항목)
- [ ] (P7) docker compose up 기동, Lighthouse 수치

## 4. 보고 형식

```
## 검증 결과
- typecheck: PASS/FAIL
- lint: PASS/FAIL
- test: PASS (N passed) / FAIL (원문 요약)
- build: PASS/FAIL
- 기동: …
- 기능 회귀: 항목별 결과
- 사용자 직접 확인 필요: …
- 발견된 문제: … (없으면 "없음")
```

문제를 발견하면 보고까지만 한다 — 수정은 사용자 지시 또는 implement-phase 흐름에서.
