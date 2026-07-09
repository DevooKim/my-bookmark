---
name: review-phase
description: 완료된 Phase를 스펙(docs)과 수용 기준에 대조해 적대적으로 리뷰한다. Phase 완료 직후 별도 세션에서 실행하면 효과적. 사용:/review-phase N
argument-hint: <phase-number>
---

# Phase 리뷰 워크플로우

방금 구현된 Phase N을 **구현자가 아닌 리뷰어의 눈**으로 검증한다. 목표는 칭찬이 아니라 결함 발견이다.

## 기본 원칙

- 리뷰는 구현 세션과 분리된 새 컨텍스트에서 받는다.
- 리뷰어는 수정하지 않는다. 결함 보고만 한다.
- 원 세션은 리뷰 결과를 사용자에게 보고한다.
- 사용자가 수정 진행을 승인하면, 원 세션에서 지적사항을 수정하고 검증 루프를 다시 실행한다.

## herdr 격리 리뷰 절차 (우선 사용)

herdr 안에서 실행 중이면(`HERDR_ENV=1`) 새 패널에 `pi` 리뷰어를 띄워 리뷰를 받는다.

1. 현재 pane id를 확인한다.

```bash
herdr pane list
```

2. 현재 pane을 오른쪽으로 split하고 새 pane id를 저장한다. `CURRENT_PANE`은 `pane list`에서 `focused:true`인 pane id다.

```bash
REVIEW_PANE=$(herdr pane split "$CURRENT_PANE" --direction right --no-focus \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["pane"]["pane_id"])')
```

3. 새 pane에서 `pi`를 실행하고 agent가 입력 가능 상태가 될 때까지 기다린다.

```bash
herdr pane run "$REVIEW_PANE" "cd /Users/hyunwookim/Dev/apps/my-bookmark && pi"
herdr wait agent-status "$REVIEW_PANE" --status idle --timeout 60000
```

4. 리뷰어에게 아래 프롬프트를 보낸다. Phase 번호가 인자로 없으면 `PROGRESS.md`의 현재 완료 Phase를 사용한다.

```bash
herdr pane run "$REVIEW_PANE" "Review Phase N of this repository as an adversarial reviewer. Read PROGRESS.md, docs/09-roadmap.md Phase N, and every referenced docs/*.md. Then inspect all code changes for Phase N using git log/diff. Do not modify files. Report findings only, in the project's review-phase format: HIGH/MED/LOW with file:line, spec basis, and scenario. If there are no findings, state the exact verification scope."
```

5. 리뷰어가 끝날 때까지 기다리고 결과를 읽는다.

```bash
herdr wait agent-status "$REVIEW_PANE" --status done --timeout 600000
herdr pane read "$REVIEW_PANE" --source recent-unwrapped --lines 240
```

6. 원 세션에서 리뷰 결과를 사용자에게 요약 보고한다. 지적이 있으면 사용자에게 수정 진행 여부를 묻는다.

> herdr가 아니거나 새 pane 생성이 실패하면, 아래 "인라인 리뷰 절차"를 수행하고 그 사실을 보고한다.

## 인라인 리뷰 절차

1. `docs/09-roadmap.md`의 Phase N(작업 목록 + 수용 기준)과 참조 문서를 읽는다.
2. 이번 Phase에서 변경된 코드를 전부 읽는다 (`git log`/`git diff`로 범위 파악).
3. 아래 관점으로 대조한다:

### 스펙 준수
- 수용 기준 각 항목이 실제 코드로 충족되는가? "될 것 같은" 코드가 아니라 실제로 확인 (필요하면 실행).
- docs의 명세(에러 포맷, 상태 전이, 정규화 규칙, 캐시 전략 등)와 구현이 정확히 일치하는가?
- 범위 밖 기능이 슬쩍 들어오지 않았는가?

### 정확성 (이 프로젝트의 상습 결함 지점)
- 모든 DB 쿼리에 `user_id` 필터가 있는가 (secret key는 RLS bypass — docs/04-auth)
- fire-and-forget promise에 `.catch()`가 있는가 (docs/05-ai)
- 조건부 UPDATE로 경합(AI vs 수동 분류, cron 중복 발송)을 막았는가
- zod 검증이 경계마다 있는가, `as`/`any`로 우회한 곳은 없는가
- 비밀값(secret key, API key 원문, VAPID private)이 클라이언트/로그/응답에 새지 않는가
- SW가 `POST /api/*`를 캐시하지 않는가

### 품질
- 테스트가 수용 기준의 핵심 로직을 실제로 커버하는가 (형식적 테스트 아닌지)
- 에러 경로: 실패 시 사용자에게 피드백이 가는가, 서버가 죽지 않는가

## 보고 형식

발견 사항을 심각도순으로:

```
### [HIGH|MED|LOW] 제목
- 위치: 파일:라인
- 문제: (스펙 근거 — docs/XX의 어느 조항)
- 시나리오: 어떤 입력/상태에서 어떻게 잘못되는가
```

- 발견 없으면 "결함 없음 — 확인한 범위: …"로 확인 범위를 명시.
- **수정은 하지 않는다.** 보고 후 사용자(또는 implement-phase 세션)가 결정.
