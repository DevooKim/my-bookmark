# AI Provider 설정 및 API 키 관리 설계

## 목표

설정 화면에서 사용자가 Gemini, Anthropic, OpenAI 중 AI provider를 선택하고 각 provider의 API 키를 안전하게 저장·교체·삭제할 수 있게 한다. 변경 사항은 API 서버 재시작 없이 다음 AI 분류부터 적용한다.

기존 `.env`의 `AI_PROVIDER`, `AI_MODEL`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`는 실행 설정으로 사용하지 않는다. AI 설정의 유일한 원본은 DB이며 모델은 각 provider의 코드 기본값을 사용한다.

## 범위

포함:

- 사용자별 활성 provider 저장
- provider별 API 키 암호화 저장, 교체, 삭제
- 설정 화면에서 provider 선택과 키 관리
- 사용자별 설정을 이용한 북마크 AI 분류
- 설정 API, 암호화, UI 및 분류 경로 테스트
- 관련 환경변수·설계 문서·진행 로그 갱신

제외:

- 사용자 지정 모델 선택
- API 키 저장 시 provider 외부 API를 호출하는 유효성 검사
- 키 사용량·비용 조회
- 기존 `.env` AI 키의 DB 자동 이관 또는 fallback

## 데이터 모델

새 마이그레이션에 `public.ai_settings` 테이블을 추가한다.

- `user_id uuid primary key references auth.users(id) on delete cascade`
- `provider text not null default 'gemini'`이며 `gemini | anthropic | openai` 제약
- `gemini_api_key_encrypted text null`
- `anthropic_api_key_encrypted text null`
- `openai_api_key_encrypted text null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()` 및 기존 `set_updated_at` 트리거

테이블에 RLS를 활성화하고 `auth.uid() = user_id`인 소유자 정책을 둔다. API 서버는 secret key로 RLS를 우회하므로 모든 조회·변경에도 `user_id` 조건을 명시한다.

설정 행이 없는 사용자는 활성 provider가 `gemini`이고 모든 키가 미설정된 것으로 간주한다. 첫 저장 시 upsert로 행을 생성한다.

## 암호화와 비밀정보 처리

API 키는 Node `crypto`의 AES-256-GCM으로 암호화한다. `AI_SETTINGS_ENCRYPTION_KEY`는 정확히 32바이트인 base64 값이며 서버 환경변수로만 제공한다. 저장 문자열은 버전, 무작위 IV, 인증 태그, 암호문을 포함하는 형식으로 인코딩해 향후 포맷 변경을 구분할 수 있게 한다.

- 매 암호화마다 새로운 12바이트 IV를 생성한다.
- 인증 태그를 검증하지 못하거나 포맷이 잘못된 암호문은 복호화 실패로 처리한다.
- 마스터 키가 없거나 base64 디코딩 결과가 32바이트가 아니면 API 서버는 기동 단계에서 실패한다.
- 평문 API 키는 DB, HTTP 조회 응답, 애플리케이션 로그에 남기지 않는다.
- 클라이언트에는 각 provider의 `configured` 여부만 반환한다.
- 키 입력은 password 필드로 표시하고 저장 후 즉시 입력값을 비운다.

`.env.example`, Docker 설정 및 배포 문서에는 마스터 키 생성·설정 방법만 추가한다. 기존 AI provider/API 키 환경변수는 제거한다.

## HTTP API

모든 AI 설정 API는 Bearer 인증 전용이다.

### `GET /api/ai`

응답:

```json
{
  "provider": "gemini",
  "enabled": true,
  "providers": {
    "gemini": { "configured": true },
    "anthropic": { "configured": false },
    "openai": { "configured": true }
  }
}
```

`enabled`는 현재 선택된 provider에 키가 설정되어 있는지를 뜻한다. 설정 행이 없으면 `provider: "gemini"`, `enabled: false`, 모든 `configured: false`를 반환한다.

### `PUT /api/ai`

요청:

```json
{
  "provider": "openai",
  "apiKey": "sk-..."
}
```

- `provider`는 필수이며 활성 provider로 저장한다.
- `apiKey`는 선택 사항이다.
- 문자열이 있으면 해당 provider의 기존 키를 교체한다.
- 생략하면 기존 키를 유지한 채 provider만 변경한다.
- trim 후 비어 있거나 512자를 넘는 키는 zod로 거부한다.
- 응답은 갱신된 `GET /api/ai` 형태이며 평문 키를 포함하지 않는다.

### `DELETE /api/ai/keys/:provider`

해당 provider의 암호화 키를 `null`로 바꾼다. 활성 provider의 키를 삭제하는 것도 허용하며 이 경우 `enabled`가 `false`가 된다. 응답은 갱신된 AI 상태다.

API 오류는 기존 `{ error: { code, message } }` 형식을 유지한다. 복호화 실패는 키·암호문을 노출하지 않는 일반적인 서버 오류로 반환한다.

## 서버 구성과 분류 흐름

현재 부팅 시 전역 singleton으로 만드는 provider를 사용자 설정 기반 서비스로 교체한다.

1. 북마크 생성 또는 재분류 라우트가 인증된 `userId`를 분류 파이프라인에 전달한다.
2. AI 설정 서비스가 `user_id`로 설정을 조회한다.
3. 활성 provider의 암호화 키가 없으면 provider를 반환하지 않는다.
4. 키가 있으면 복호화하고 `createAiProvider`로 provider를 만든다.
5. 기존 메타데이터 수집 및 조건부 AI 결과 적용 흐름을 그대로 실행한다.

provider 인스턴스는 사용자 ID를 키로 한 `Map`에 캐시한다. 최초 요청에서 DB 설정을 읽어 생성하고, `PUT` 또는 `DELETE` 성공 시 해당 사용자의 항목을 반드시 삭제해 다음 분류부터 변경 사항이 즉시 적용되게 한다. 별도 전역 상태 관리 시스템이나 만료 정책은 도입하지 않는다.

설정 또는 키가 없거나 provider 생성이 불가능하면 기존 비활성 동작을 유지한다. 메타데이터는 수집하고 북마크의 `ai_status`는 `failed`로 종결하며 서버 프로세스는 계속 동작한다.

## 설정 화면

기존 읽기 전용 **AI 분류** 섹션을 편집 가능한 폼으로 바꾼다.

- provider select: Gemini, Anthropic, OpenAI
- 선택 provider의 설정 상태: `설정됨` 또는 `API 키 필요`
- password 타입 API 키 입력
- `저장` 버튼: provider 선택을 저장하고 입력값이 있으면 키도 교체
- 설정된 provider에는 `키 삭제` 액션 제공
- 세 provider의 설정 여부를 간단한 목록 또는 배지로 표시
- 저장된 키 원문이나 일부(prefix 포함)는 다시 표시하지 않음

provider만 변경할 때 키를 재입력할 필요가 없다. 키가 없는 provider를 선택하는 것도 허용하되 경고 상태를 명확히 표시한다. 저장·삭제 중 버튼을 비활성화하고 성공/실패는 기존 sonner 토스트로 알린다. mutation 성공 시 `['ai']` query를 갱신한다.

기존 단축어용 **API 키** 섹션은 이름과 동작을 유지하며 AI API 키와 시각적으로 별도 섹션으로 구분한다.

## 검증

자동 테스트:

- AES-256-GCM round-trip
- 같은 평문의 무작위 IV에 따른 서로 다른 암호문
- 다른 마스터 키, 변조된 인증 태그, 잘못된 포맷의 복호화 실패
- 환경변수 누락·잘못된 길이 거부
- AI 설정 기본 상태, 저장, provider 변경, 키 교체, 삭제
- API 조회 응답에 키 평문과 암호문이 모두 없는지 확인
- 모든 DB 접근의 사용자 ID 경계
- 설정 변경 후 캐시 무효화 및 새 provider 사용
- 선택 provider 키 미설정 시 기존 `ai_status='failed'` 동작
- 설정 UI의 provider 선택, configured 상태, 저장·삭제, 오류 피드백

최종 검증:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

필요하면 인증된 브라우저에서 provider 선택 → 키 저장 → AI 북마크 등록 → 분류 완료 → 키 삭제 후 비활성 상태까지 수동 확인한다.
