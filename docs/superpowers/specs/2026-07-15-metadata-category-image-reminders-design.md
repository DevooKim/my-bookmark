# 메타데이터·카테고리·이미지 색상·리마인더 개선 설계

## 목표

링크형 메타데이터 뱃지의 호버 피드백을 통일하고, 모바일 카테고리 관리 행을 한 줄로 정리한다. 이미지 파생본은 입력 색공간과 무관하게 웹에서 안정적인 sRGB 색상으로 표시한다. 리마인더는 알림 발송 뒤에도 이력을 목록에 유지하며, 반복·일시정지·재활성화·다시 알림을 지원한다.

## 범위

- 범용 메타데이터 URL 뱃지의 호버 스타일
- 설정 화면의 모바일 카테고리 관리 행
- 서버 이미지 썸네일 WebP와 AI 분석용 JPEG의 색공간 정규화
- 리마인더 DB 계약, API, 스케줄러, 설정 모달과 목록 UI
- 관련 문서, 마이그레이션, 자동 테스트와 `PROGRESS.md`

기존 원본 이미지 파일의 변환, 과거 썸네일의 일괄 재생성, 취소된 리마인더 복구, 임의 cron 표현식과 반복 종료일·횟수 설정은 범위 밖이다.

## 메타데이터 URL 뱃지

URL 값인 메타데이터는 key 종류와 무관하게 같은 파란색 스타일을 사용한다. 기본 상태는 현재의 연한 파란 배경과 파란 글자를 유지하고, hover 시 진한 파란 배경과 흰 글자로 전환한다. 기존 `네이버지도` 전용 녹색 hover 분기는 제거한다. dark mode에서도 진한 파란 배경과 흰 글자를 보장하며 키보드 포커스 동작은 유지한다.

텍스트 값인 메타데이터 뱃지는 링크가 아니므로 기존 중립색 스타일을 유지한다.

## 모바일 카테고리 관리

카테고리 행은 모든 화면 크기에서 다음 한 줄 순서를 사용한다.

`드래그 핸들 | 카테고리 이름 | 북마크 개수 | 삭제 버튼`

모바일 grid를 `auto / minmax(0, 1fr) / auto / auto` 네 열로 구성하고 간격을 좁힌다. 이름 input은 `min-width: 0`으로 남은 폭 안에서 줄어들며, 개수와 삭제 버튼은 축소되지 않는다. 기존 DND 센서, 터치·키보드 조작, 이름 저장 시점, 삭제 확인과 최소 터치 영역은 변경하지 않는다.

## 이미지 색공간 정규화

원본 파일은 현재처럼 바이트 그대로 보존한다. Sharp로 생성하는 썸네일 WebP와 AI 분석용 JPEG에는 `withIccProfile("srgb")`를 적용해 다음을 한 번에 수행한다.

1. 입력 파일에 포함된 Display P3·CMYK 등 ICC 프로필을 기준으로 픽셀을 sRGB로 변환한다.
2. 파생 파일에 sRGB ICC 프로필을 부착해 브라우저와 AI 소비자가 같은 색상 의미로 해석하게 한다.

resize·회전·품질·최대 크기는 변경하지 않는다. HEIC는 휴대 가능한 decoder가 RGBA로 해석한 결과를 기존 Sharp 파이프라인에 전달하며 동일한 sRGB 출력 계약을 적용한다. 회귀 테스트는 wide-gamut 프로필 입력으로 생성한 파생 WebP/JPEG가 sRGB 색공간과 ICC 프로필을 갖는지 확인한다.

## 리마인더 데이터 모델

`reminders`에 다음 컬럼을 추가한다.

- `recurrence`: `none | daily | weekly | monthly`, 기본값 `none`
- `recurrence_timezone`: IANA timezone 문자열, 기존 행 기본값 `UTC`
- `is_enabled`: boolean, 기본값 `true`

`remind_at`은 단발 알림의 설정 시각 또는 반복 알림의 다음 실행 시각이다. `sent_at`은 가장 최근 실제 클레임 시각이다. 기존 `pending | sent | cancelled` 상태는 유지한다.

- 단발 알림은 발송 후 `sent`가 된다.
- 활성 반복 알림은 `pending`을 유지하면서 `remind_at`이 다음 실행 시각으로 이동한다.
- 비활성 반복 알림은 `pending`, `is_enabled=false`로 목록에는 남지만 스케줄 대상에서 제외된다.
- 휴지통으로 숨긴 항목만 `cancelled`가 된다.

기존 데이터는 반복 없음·활성 상태로 호환한다. 마이그레이션은 check constraint와 기존 due index를 새 조회 조건에 맞게 갱신한다.

## 반복 시각 계산

반복 규칙은 최초 설정 시 브라우저가 전달한 IANA timezone의 로컬 달력을 기준으로 계산한다. 새 날짜 라이브러리는 추가하지 않고 서버의 `Intl.DateTimeFormat`을 사용하며 timezone은 실제 formatter 생성으로 검증한다.

- 매일: 같은 로컬 시각의 다음 날
- 매주: 같은 로컬 요일과 시각의 다음 주
- 매월: 같은 로컬 날짜와 시각의 다음 달
- 다음 달에 해당 날짜가 없으면 그 달의 마지막 날

서버 중단 등으로 여러 회차가 지났다면 한 번만 알림을 보내고 현재 시각보다 미래인 가장 가까운 다음 회차까지 건너뛴다. 재활성화도 동일하게 과거 회차를 건너뛴다.

## 스케줄러와 중복 방지

due 조회는 `status='pending'`, `is_enabled=true`, `remind_at <= now()` 조건을 사용한다. 클레임 update에는 id뿐 아니라 기존 `status`, `is_enabled`, `remind_at`을 조건으로 넣는다.

- 단발: `status='sent'`, `sent_at=now()`로 갱신
- 반복: `remind_at=next`, `sent_at=now()`로 갱신하고 `pending` 유지

조건부 update가 성공한 worker만 푸시를 전송한다. 따라서 여러 API 인스턴스가 같은 due 행을 읽어도 한 인스턴스만 해당 회차를 처리한다. 기존 정책처럼 DB 클레임은 푸시보다 먼저 수행하며, 전체 구독 발송 실패를 위한 별도 재시도 큐는 추가하지 않는다.

## API 계약

- `POST /api/reminders`: 기존 필드에 `recurrence`, `recurrenceTimezone`을 추가한다. 생략 시 반복 없음과 브라우저 timezone 기본 입력을 사용한다.
- `GET /api/reminders`: 사용자 소유 행 중 `cancelled`를 제외한 예정·지난·비활성 리마인더를 반환한다.
- `PATCH /api/reminders/:id`: pending 리마인더의 시간·메모·반복 규칙을 수정하고 반복 리마인더의 `isEnabled`를 전환한다. 다시 활성화할 때 과거 실행 시각이면 다음 미래 회차로 이동한다.
- `POST /api/reminders/:id/reschedule`: 지난 단발 리마인더를 미래의 `pending` 일정으로 되돌린다. 시간·메모·반복 규칙을 새로 받아 같은 행을 재사용한다.
- `DELETE /api/reminders/:id`: pending과 sent 모두 `cancelled`로 바꾼다.

모든 body와 response는 `packages/shared` Zod 스키마로 검증한다. 단발 리마인더에 `isEnabled=false`를 지정하거나 잘못된 timezone·과거 재예약 시각을 전달하면 400 공통 오류를 반환한다. 다른 사용자의 행과 취소된 행은 변경하지 않는다.

## 리마인더 UI

설정 모달에는 `알림 시간`, `반복 없음/매일/매주/매월`, `메모`를 표시한다. 저장 시 `Intl.DateTimeFormat().resolvedOptions().timeZone`을 함께 전송한다.

목록은 `cancelled` 이외의 항목을 표시한다.

- 미래 일정은 기존 파란 시계와 날짜를 사용한다.
- 지난 단발 일정과 처리 지연으로 이미 지난 pending 일정은 날짜·시계 아이콘을 빨간색으로 표시한다.
- 지난 단발 일정에는 `다시 알림` 버튼을 표시하고 기존 메모를 채운 설정 모달을 연다.
- 반복 일정에는 `매일`, `매주`, `매월` 뱃지와 `비활성화/활성화` 버튼을 표시한다.
- 비활성 반복 일정은 중립 회색 스타일과 `비활성` 상태를 표시한다.
- 휴지통은 모든 표시 상태를 취소해 목록에서 숨긴다.

다시 알림 성공, 활성 상태 전환과 삭제 성공은 `['reminders']` query를 invalidate한다. 버튼은 작업 중 중복 실행되지 않으며 accessible name으로 동작을 구분한다.

## 오류 처리

- 이미지 변환 실패는 기존 `ImageProcessingError` 경계를 유지한다.
- 반복 계산 중 유효하지 않은 timezone이나 계산 불가능한 값은 400 또는 서버 내부 오류로 명확히 전달하고 삼키지 않는다.
- 클레임 경쟁에서 조건부 update 결과가 없으면 정상 skip한다.
- 반복 상태 변경이나 다시 알림 실패 시 목록을 낙관적으로 숨기지 않고 오류 toast를 표시한다.

## 테스트와 검증

- 메타데이터: 모든 URL 뱃지의 진한 파란 hover와 네이버지도 특례 제거
- 카테고리: 모바일 한 줄 네 열 grid, input 축소, 기존 DND accessible name 유지
- 이미지: Display P3 프로필 입력의 WebP/JPEG가 sRGB 및 ICC 프로필을 보유
- shared: 반복 enum, create/update/reschedule 요청과 reminder 응답 계약
- API route: sent 항목 목록 유지, 모든 표시 상태 취소, 비활성화·재활성화, 다시 알림 권한/상태/시간 검증
- 반복 계산: 일·주·월, 월말 보정, timezone, 누락 회차 건너뛰기
- cron: 단발 sent 전이, 반복 다음 시각 전이, 비활성 제외, 경쟁 worker 중복 방지
- web: 반복 설정 전송, 지난 항목 빨간 표시, 다시 알림, 활성 토글, 삭제 후 invalidate
- 전체 `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build`

마이그레이션은 linked project에 대해 dry-run으로 대상 파일을 확인한 뒤 적용하고 migration 이력과 DB lint를 검증한다. 구현 완료 후 관련 문서와 `PROGRESS.md`에 동작과 검증 결과를 기록한다.

## 완료 기준

네 가지 최초 요청과 확장된 리마인더 요구가 자동 테스트로 고정되고 전체 검증 루프가 통과해야 한다. 원본 이미지는 변경하지 않으며 새로 생성되는 파생 이미지부터 sRGB 계약을 적용한다. 예정·지난·비활성 리마인더는 사용자가 휴지통으로 숨기기 전까지 목록에 남아야 한다.
