# Bun 패키지 매니저 및 Vercel 런타임 전환 설계

## 목표

모노레포의 패키지 매니저를 pnpm에서 Bun으로 완전히 교체한다. API와 Docker의 프로덕션 런타임은 최신 LTS인 Node.js 24로 올리고, Vercel에 배포하는 `apps/web`만 Bun 1.x 런타임 Beta를 사용한다.

## 범위

- 루트 워크스페이스 정의와 모든 저장소 명령을 Bun 기준으로 전환한다.
- `pnpm-lock.yaml`과 `pnpm-workspace.yaml`을 `bun.lock` 및 루트 `package.json#workspaces`로 대체한다.
- pnpm 전용 lifecycle 허용 설정을 Bun의 `trustedDependencies`로 대체한다.
- 루트와 각 워크스페이스의 내부 pnpm 호출을 Bun 호출로 바꾼다.
- 두 Dockerfile의 의존성 설치와 빌드를 Bun으로 바꾸고, 최종 런타임 이미지는 Node.js 24 LTS를 사용한다.
- API의 tsup 빌드 target을 Node.js 24로 올린다.
- Vercel의 web 프로젝트에 Bun 1.x 런타임 Beta를 명시하고 Nitro의 Vercel 배포 산출물을 사용한다.
- 작업 지침, 아키텍처, 로드맵, 배포 가이드와 사용자용 명령 예제를 Bun 기준으로 갱신한다.
- `PROGRESS.md`에 전환 결정과 검증 결과를 기록한다.

## 제외 범위

- Express API를 Bun 런타임으로 실행하지 않는다.
- Docker 프로덕션 컨테이너를 Bun 런타임으로 바꾸지 않는다.
- 애플리케이션 기능, API 계약, 데이터베이스 스키마는 변경하지 않는다.
- Vercel 외의 API 배포처를 이번 작업에서 새로 결정하지 않는다.

## 패키지와 워크스페이스

루트 `package.json`에 `workspaces: ["apps/*", "packages/*"]`를 선언하고 `packageManager`를 현재 개발 환경과 일치하는 `bun@1.3.14`로 고정한다. 내부 패키지의 `workspace:*` 의존성 표기는 그대로 유지한다.

`bun.lock`은 기존 pnpm lockfile에서 마이그레이션해 가능한 한 현재 해석된 버전을 보존한다. 이후 `bun install --frozen-lockfile`이 성공해야 재현 가능한 설치로 인정한다. Bun이 기본적으로 차단하는 lifecycle script 가운데 실제 빌드에 필요한 `esbuild`와 `lightningcss`만 루트 `trustedDependencies`에 둔다.

루트 스크립트는 Bun workspace 실행 기능을 사용한다. 개발 서버는 web과 api를 병렬 실행하고, typecheck·lint·test·build는 각 워크스페이스에서 실행한다. `apps/web`의 route 생성 및 서비스 워커 선행 빌드도 `bun run`으로 호출해 패키지 매니저 혼용을 없앤다.

## 런타임과 배포

API 빌드 target과 Docker의 최종 런타임 이미지는 Node.js 24로 맞춘다. Docker 빌드 단계에서는 Bun으로 잠금 파일 기반 의존성을 설치하되, 생성된 web Nitro 서버와 API 번들은 Node.js 24에서 실행한다. 이 경계로 Bun 패키지 매니저 전환과 서버 런타임 변경의 위험을 분리한다.

Vercel web 프로젝트는 모노레포의 `apps/web`을 Root Directory로 사용한다. `apps/web/vercel.json`에 `bunVersion: "1.x"`를 선언해 Vercel Functions를 Bun Beta 런타임으로 실행한다. 저장소 루트의 `bun.lock`으로 Bun 설치가 자동 감지되게 하고, web의 기존 `bun run build`가 서비스 워커 생성, route 생성, Nitro/Vite 빌드를 순서대로 수행하게 한다. Nitro는 Vercel 환경에서 Vercel preset을 선택하도록 명시하거나 실제 빌드 결과로 자동 감지를 확인한다.

Vercel에는 web용 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_URL`, `VITE_VAPID_PUBLIC_KEY`를 빌드 환경변수로 설정한다. API secret은 Vercel web 프로젝트에 넣지 않는다.

## 호환성과 오류 처리

- lockfile 마이그레이션 후 의존성 버전이 의도치 않게 대규모 갱신되면 전환을 중단하고 원인을 확인한다.
- lifecycle script가 차단되면 전체 허용하지 않고 필요한 패키지만 `trustedDependencies`에 추가한다.
- Bun workspace 실행에서 스크립트가 없는 패키지 때문에 실패하지 않도록 실제 워크스페이스 스크립트 구성을 기준으로 필터 또는 `--if-present`를 사용한다.
- Vercel preset 빌드가 현재 Nitro 설정과 충돌하면 타입 우회 없이 설치된 Nitro 타입과 공식 TanStack Start 문서를 기준으로 설정을 수정한다.
- Bun Beta 런타임에서 web 서버가 실패하면 Node 런타임으로 조용히 되돌리지 않고 실패 원인과 Beta 제한을 기록한다.

## 검증

1. `bun install --frozen-lockfile`
2. `bun run typecheck && bun run lint && bun run test && bun run build`
3. API 프로덕션 번들을 Node.js 24 환경에서 기동하고 `/api/health` 확인
4. web의 Node.js 24 Docker 이미지 빌드 및 `manifest.webmanifest` 헬스체크 확인
5. API의 Node.js 24 Docker 이미지 빌드 및 `/api/health` 확인
6. Vercel용 빌드에서 Nitro의 Vercel 산출물과 Bun runtime 설정 확인
7. 저장소의 활성 설정과 현재 사용자 문서에서 pnpm 참조가 남지 않았는지 검색

과거 구현 기록인 기존 설계·계획 문서의 명령은 당시 상태를 보존할 수 있다. 반면 `AGENTS.md`, `CLAUDE.md`, `README.md`, 아키텍처·로드맵·배포 문서와 현재 테스트는 모두 Bun 기준으로 갱신한다.

## 완료 조건

- 저장소의 유일한 패키지 잠금 파일이 `bun.lock`이다.
- 로컬 검증 루프가 Bun 명령으로 전부 통과한다.
- Docker의 빌드 설치는 Bun, 프로덕션 런타임은 Node.js 24다.
- Vercel web 설정은 Bun 1.x Beta 런타임을 명시한다.
- 현재 작업 지침과 운영 문서에 pnpm 기반 실행 지시가 남아 있지 않다.
- 변경 사항과 검증 결과가 `PROGRESS.md`에 기록된다.

## 근거 문서

- [Bun Workspaces](https://bun.sh/docs/pm/workspaces)
- [Bun install 및 pnpm lockfile 마이그레이션](https://bun.sh/docs/pm/cli/install)
- [Vercel Package Managers](https://vercel.com/docs/package-managers)
- [Vercel Bun Runtime](https://vercel.com/docs/functions/runtimes/bun)
- [TanStack Start Hosting](https://tanstack.com/start/latest/docs/framework/react/guide/hosting)
- [Node.js Releases](https://nodejs.org/en/about/previous-releases)
