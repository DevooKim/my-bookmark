# TypeScript 7 전환 설계

## 목표

모노레포의 모든 workspace가 동일한 TypeScript 7 compiler를 사용하도록 버전을 `7.0.2`로 고정한다. Node 관련 타입도 현재 런타임인 Node.js 24에 맞춰 compiler와 실행 환경의 차이를 줄인다.

## 현재 상태

- Bun lockfile은 루트, API, shared, AI의 `typescript: latest`를 이미 TypeScript 7.0.2로 해석한다.
- web만 `typescript: ^6.0.2`로 선언되어 TypeScript 6 계열을 별도로 사용한다.
- web의 `@types/node`는 Node 22 계열이지만 저장소의 로컬·Docker 런타임은 Node 24다.
- 현재 tsconfig는 strict, ESNext module, Bundler module resolution을 사용하며 TypeScript 7.0.2 typecheck가 이미 통과한다.

## 변경 범위

- 루트와 네 workspace의 `typescript`를 정확히 `7.0.2`로 고정한다.
- web의 `@types/node`를 Node 24 계열로 변경한다.
- `bun.lock`을 갱신하고 `bun install --frozen-lockfile`로 재현성을 확인한다.
- 모든 package manifest가 동일한 compiler를 선언하는지 회귀 테스트를 추가한다.
- TypeScript 7에서 필요한 실제 compiler 오류만 수정한다. `any`, `@ts-ignore`, strict 완화, `skipLibCheck` 추가로 오류를 덮지 않는다.
- 작업 지침과 `PROGRESS.md`의 기술 스택·결정·검증 기록을 갱신한다.

## 제외 범위

- tsconfig의 strict 정책이나 module resolution 전략을 바꾸지 않는다.
- project references, incremental build, 새로운 monorepo 도구를 도입하지 않는다.
- TypeScript 전환과 무관한 타입 리팩터링은 하지 않는다.
- 애플리케이션 런타임과 API 계약은 변경하지 않는다.

## 버전 정책

`latest`나 caret 범위 대신 정확한 `7.0.2`를 사용한다. package별 설치 시점 차이로 compiler가 다시 갈라지는 것을 막고, Bun의 단일 해석 결과를 명시적으로 재현하기 위함이다. 이후 TypeScript 갱신은 전체 workspace를 한 번에 올리고 같은 검증 루프를 통과시키는 작업으로 수행한다.

`@types/node`는 web에서 `^24`로 맞춘다. API의 `latest` 타입 선언은 별도 범위로 확대하지 않고, 이번 작업에서는 TypeScript compiler 통일과 web의 명시적 Node 22 불일치만 해소한다.

## 검증

1. manifest 회귀 테스트를 먼저 실패시킨 뒤 버전 선언을 변경한다.
2. `bun install`로 lockfile을 갱신하고 `bun install --frozen-lockfile`을 확인한다.
3. Node 24에서 `tsc --version`이 7.0.2인지 확인한다.
4. Node 24에서 typecheck, lint, 전체 테스트, build를 실행한다.
5. API와 web Docker 이미지를 빌드하고 두 서비스의 health check를 확인한다.
6. TypeScript 6 또는 web의 Node 22 타입 선언이 활성 manifest에 남지 않았는지 검색한다.

## 완료 조건

- 다섯 package manifest가 모두 `typescript: 7.0.2`를 선언한다.
- web은 Node 24 타입을 사용한다.
- frozen install과 전체 검증 루프가 통과한다.
- Docker api/web이 healthy 상태로 기동한다.
- 변경과 검증 결과가 `PROGRESS.md`에 기록된다.
