# AI API 키 관리와 모델 선택 분리 설계

## 목표

AI 설정 화면에서 API 키가 모델별로 필요한 것처럼 보이는 혼동을 제거한다. API 키는 provider 단위로 독립 관리하고, 사용할 모델은 키가 등록된 provider의 모델 중에서 별도로 선택한다.

## 화면 구조

기존의 모델 선택 + 선택 provider 키 입력 결합 폼을 두 섹션으로 분리한다.

### AI API 키

Gemini, Anthropic, OpenAI 카드 3개를 항상 표시한다. 각 카드는 독립적으로 다음을 제공한다.

- provider 이름
- `설정됨` 또는 `API 키 필요` 상태
- provider 전용 password 입력
- 미설정이면 `키 저장`, 설정 상태에서 새 값을 입력하면 `키 교체`
- 설정된 키의 `연결 테스트`
- 설정된 키의 `키 삭제`

입력값은 provider별 React state에 분리해 한 provider 작업이 다른 입력을 지우거나 전환하지 않게 한다. 저장 성공 시 해당 provider 입력만 비운다. 저장된 키 원문은 재표시하지 않는다.

### 사용 모델

API 키가 설정된 provider의 모델만 고정 카탈로그에서 필터링해 provider별 optgroup으로 표시한다.

- 키가 하나도 없으면 select를 렌더링하지 않고 “먼저 provider API 키를 등록하세요” 빈 상태를 표시한다.
- 모델 변경은 별도 `모델 저장` 버튼으로 확정한다.
- 현재 활성 모델 provider의 키가 삭제되고 다른 provider 키가 남아 있으면 UI는 남은 첫 모델을 임시 선택하되 자동 저장하지 않는다.
- 활성 모델 provider의 키가 삭제되면 서버 상태는 기존 provider/model을 유지하면서 `enabled=false`가 된다.
- 키가 하나도 없으면 AI는 비활성 상태이며 모델 저장 버튼을 표시하지 않는다.

## HTTP API

기존 결합형 `PUT /api/ai`를 두 경계로 교체한다.

### `PUT /api/ai/keys/:provider`

요청:

```json
{ "apiKey": "..." }
```

provider별 키를 신규 저장하거나 교체한다. 활성 provider/model은 변경하지 않는다. trim 후 빈 값 또는 512자 초과는 400이다. 응답은 갱신된 AI 상태이며 키를 포함하지 않는다.

### `PUT /api/ai/model`

요청:

```json
{ "provider": "openai", "model": "gpt-4o-mini" }
```

고정 카탈로그의 유효한 provider/model 조합이며 해당 provider 키가 저장된 경우에만 활성 모델로 저장한다. 키가 없으면 400이다. 응답은 갱신된 AI 상태다.

기존 API는 유지한다.

- `GET /api/ai`
- `POST /api/ai/test/:provider`
- `DELETE /api/ai/keys/:provider`

웹 클라이언트는 더 이상 결합형 `PUT /api/ai`를 호출하지 않는다. 라우트도 제거해 모호한 쓰기 경계를 남기지 않는다.

## 서비스 구조

`AiSettingsService.save`를 다음 두 메서드로 분리한다.

- `saveKey(userId, provider, apiKey)` — 대상 암호화 키 컬럼만 변경하고 활성 provider/model 유지
- `selectModel(userId, { provider, model })` — 대상 provider 키 존재를 확인한 뒤 provider/model만 변경

두 메서드 모두 저장 성공 후 사용자 provider 캐시를 무효화한다. 연결 테스트, 키 삭제, 실제 분류 provider 생성 방식은 유지한다.

## 오류 및 보안

- 모든 요청 본문과 provider parameter는 shared zod schema로 검증한다.
- 키 저장 응답, 상태 조회, 오류 응답에 평문/암호문을 포함하지 않는다.
- 키 저장만으로 활성 모델을 자동 변경하지 않는다.
- 키 삭제만으로 기존 모델을 자동 변경하지 않는다.
- 키가 없는 provider 모델 선택은 UI 필터와 서버 검증으로 이중 차단한다.
- 연결 테스트는 기존처럼 Models API만 호출한다.

## 검증

자동 테스트:

- provider 키 저장이 활성 provider/model을 변경하지 않음
- provider별 키 저장/교체가 다른 provider 키를 유지함
- 키가 있는 provider만 모델 선택 가능
- 분리된 HTTP endpoint의 인증·validation·비밀정보 비노출
- provider 카드 3개와 독립 key input/save 동작
- 키 설정 provider 모델만 optgroup에 표시
- 키 0개 빈 상태
- 별도 모델 저장 동작
- 연결 테스트/삭제 회귀

최종 검증:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Docker 재빌드 후 실제 OpenAI 키가 `설정됨` 카드로 표시되고 Gemini/Anthropic은 별도 입력을 가지며, 사용 모델 목록에는 OpenAI 모델만 표시되는지 브라우저에서 확인한다.
