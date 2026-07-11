# AI 모델 선택 및 API 키 연결 테스트 설계

## 목표

설정된 모든 AI provider의 추천 모델을 하나의 선택기에서 고르고, 저장된 provider별 API 키가 유효한지 추론 비용 없이 확인할 수 있게 한다.

## 모델 카탈로그

모델 목록은 외부 API에서 동적으로 가져오지 않고 `packages/shared`의 고정 카탈로그를 서버와 웹이 함께 사용한다. 고성능 모델은 제외하고 provider별 저비용·균형 모델만 제공한다.

| Provider | Model ID | 표시명 | 등급 |
|---|---|---|---|
| Gemini | `gemini-flash-lite-latest` | Gemini Flash Lite | 저비용 |
| Gemini | `gemini-flash-latest` | Gemini Flash | 균형 |
| Anthropic | `claude-haiku-4-5` | Claude Haiku 4.5 | 저비용 |
| Anthropic | `claude-sonnet-4-6` | Claude Sonnet 4.6 | 균형 |
| OpenAI | `gpt-4o-mini` | GPT-4o mini | 저비용 |
| OpenAI | `gpt-5.4-mini` | GPT-5.4 mini | 균형 |

각 항목은 `provider`, `model`, `label`, `tier`를 가진다. 서버는 요청의 provider/model 조합이 카탈로그에 있는지 zod refinement로 검증한다. 웹은 임의 문자열을 만들지 않고 같은 카탈로그를 렌더링한다.

## 데이터 모델

새 마이그레이션으로 `ai_settings.model`을 추가한다.

기존 행은 현재 provider에 따라 저비용 기본 모델로 채운다.

- Gemini → `gemini-flash-lite-latest`
- Anthropic → `claude-haiku-4-5`
- OpenAI → `gpt-4o-mini`

그 후 `model`을 `not null`로 바꾸고 provider/model이 카탈로그의 유효한 조합인 SQL check를 추가한다. 신규 설정 행의 기본 조합은 Gemini + `gemini-flash-lite-latest`다.

provider별 API 키 저장 구조와 AES-256-GCM 암호화 방식은 변경하지 않는다. 활성 설정은 사용자별 단일 `{ provider, model }` 조합이다.

## HTTP API

### AI 상태

`GET /api/ai` 응답에 현재 `model`을 추가한다.

```json
{
  "provider": "openai",
  "model": "gpt-4o-mini",
  "enabled": true,
  "providers": {
    "gemini": { "configured": false },
    "anthropic": { "configured": false },
    "openai": { "configured": true }
  }
}
```

### 설정 저장

`PUT /api/ai` 요청은 `provider`와 `model`을 필수로 받으며 `apiKey`는 기존처럼 선택 사항이다.

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "apiKey": "optional replacement key"
}
```

provider/model 불일치는 `400 VALIDATION_ERROR`다. 키가 없는 provider/model 조합을 HTTP로 저장하려는 경우에도 `400`으로 거부한다. 단, 같은 요청에 해당 provider의 새 `apiKey`가 있으면 저장할 수 있다.

### 연결 테스트

`POST /api/ai/test/:provider`를 추가한다. Bearer 인증 전용이며 DB에 저장된 키만 검사한다. 요청 본문으로 키를 받지 않는다.

- 키 미설정: `400 VALIDATION_ERROR`
- Models API 성공: `200 { "provider": "openai", "ok": true }`
- 인증·권한·rate limit·네트워크·타임아웃 실패: `200 { "provider": "openai", "ok": false }`

실패 응답에는 provider SDK의 상세 오류, 응답 본문, 키 원문이나 암호문을 포함하지 않는다. 서버 로그에도 키는 기록하지 않는다. 외부 요청은 10초 안에 종료한다.

## Provider 구현

`AiProvider` 인터페이스에 `validateConnection(): Promise<void>`를 추가한다. 각 구현은 기존에 생성된 SDK client로 공식 Models API의 첫 페이지 또는 최소 1개 항목만 요청한다.

- Gemini: `models.list`
- Anthropic: `models.list`
- OpenAI: `models.list`

모델 생성·추론 API는 호출하지 않으므로 추론 토큰 비용이 없다. Models API 요청 제한에는 포함될 수 있다.

사용자별 provider 캐시는 `{ provider, model }`로 생성한다. 설정 저장 시 기존과 같이 사용자 캐시를 무효화한다. 실제 분류는 DB에 저장된 model을 `createAiProvider({ provider, model, apiKey })`에 전달한다.

연결 테스트는 활성 provider가 아니어도 실행할 수 있다. 대상 provider의 저장 키와 카탈로그 첫 번째 모델로 임시 provider를 생성해 `validateConnection`을 호출한다. 테스트용 인스턴스는 분류 캐시에 저장하지 않는다.

## 설정 화면

기존 provider select를 모델 선택기로 교체한다.

- provider별 `<optgroup>`으로 6개 모델 표시
- 항목에 모델 표시명과 `저비용`/`균형` 등급 표시
- API 키가 없는 provider의 모델도 `API 키 필요`와 함께 선택 가능하게 표시해 같은 폼에서 새 키를 입력할 수 있게 함
- 현재 활성 provider의 키가 없는 기존 상태는 현재 모델을 계속 표시하되 저장 전 키 입력을 요구
- 모델을 선택하면 provider는 카탈로그 정보에서 자동 결정
- 저장 버튼은 선택된 `{ provider, model }`과 선택 provider에 입력한 새 키를 전송

provider별 키 상태 목록에는 설정된 키마다 `연결 테스트`와 `키 삭제` 버튼을 둔다.

- 테스트 중 해당 행의 버튼만 비활성화하고 로딩 문구 표시
- `ok: true` → “OpenAI 연결에 성공했어요” 토스트
- `ok: false` → “OpenAI API 키를 확인해 주세요” 토스트
- 네트워크/API 자체 실패 → “연결 테스트를 완료하지 못했어요” 토스트

저장된 키는 계속 재표시하지 않는다.

## 오류 처리

- provider/model 조합은 HTTP 경계와 DB check에서 이중 검증한다.
- 키가 없는 provider 모델을 선택하면 UI가 새 키 입력을 안내하고, 서버는 같은 저장 요청에 새 키가 없으면 거부한다.
- Models API 실패는 설정이나 키를 자동 삭제하지 않는다.
- 연결 성공은 해당 모델의 추론 권한·quota까지 보장하지 않는다. UI 설명에 “API 키 연결만 확인합니다”를 표시한다.
- 실제 분류 실패는 기존처럼 `ai_status='failed'`로 종결한다.

## 검증

자동 테스트:

- 카탈로그의 6개 모델과 provider/model 조합 zod 검증
- 기존 행 provider별 모델 backfill SQL
- model 저장·조회와 키 없는 provider 선택 거부
- 선택 model이 `createAiProvider` config에 전달되는지 확인
- Gemini/Anthropic/OpenAI Models API mock 성공·실패·타임아웃
- 연결 테스트 API의 인증, 키 미설정, `ok: true/false`, 비밀정보 비노출
- 모델 optgroup, 키 없는 provider 옵션의 `API 키 필요` 안내, 모델 저장
- provider별 연결 테스트 버튼과 성공/실패 피드백

최종 검증:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

원격 마이그레이션 적용 후 Docker 스택과 실제 설정 화면에서 모델 선택 저장, 저장된 OpenAI 키 연결 테스트, 키 미설정 provider 모델의 안내 표시를 확인한다.
