# 이미지 출처 링크와 업로드 UX 후속 설계

## 목표

이미지에서 유튜브·인스타그램·스레드·X·틱톡·GitHub 출처를 충분히 확실하게 식별한 경우 기존 범용 메타데이터에 검증된 링크를 추가한다. 같은 범위에서 HEIC 선택 후 로컬 미리보기가 깨지는 문제를 해결하고, 추가 모달의 이미지가 모두 저장되면 자동으로 닫힌다.

쇼핑몰·상품 링크는 판매처와 정확한 상품을 안전하게 확정하기 어렵다는 판단에 따라 이번 범위에서 제외한다.

## 범위

### 포함

- 이미지 AI 분석의 nullable 출처 후보
- 서버의 플랫폼별 URL 검증·생성
- 유튜브·인스타그램·스레드·X·틱톡의 게시물 또는 프로필 링크
- GitHub 저장소 또는 프로필 링크
- HEIC/HEIF 파일의 브라우저 로컬 미리보기
- 추가 모달의 전체 저장 성공 후 자동 닫기

### 제외

- 쇼핑몰·상품 URL
- SNS 검색 결과 링크
- 로고·인물·표시명만으로 계정 추측
- 서버에 임시 HEIC 미리보기를 선업로드하는 전용 API
- PWA 공유 화면의 자동 이동

## AI 출처 후보

AI가 임의 메타데이터를 직접 만들거나 임의 URL을 무조건 저장하게 하지 않는다. `AnalyzeResult`에 다음 nullable 후보를 추가한다.

```ts
type SourcePlatform =
  | "youtube"
  | "instagram"
  | "threads"
  | "x"
  | "tiktok"
  | "github";

interface SourceCandidate {
  platform: SourcePlatform;
  handle: string | null;
  postUrl: string | null;
  repository: string | null;
  confidence: number;
}
```

- `handle`: 이미지에서 직접 확인된 계정 handle만 반환한다. 선행 `@`는 허용하되 서버가 제거한다.
- `postUrl`: URL 표시, QR, 게시물 id등 이미지에 직접 확인된 정보로 해당 게시물 URL을 재구성할 수 있을 때만 반환한다.
- `repository`: GitHub의 `owner/repository` 표기가 직접 확인될 때만 반환한다.
- 표시명·로고만 보이거나 추측이 필요하면 `source` 전체를 `null`로 반환한다.
- strict JSON Schema에서는 `source`와 모든 하위 필드를 required + nullable로 선언한다.

링크 북마크는 이미 자신의 원본 URL을 가지므로 이 자동 출처 메타데이터는 `kind='image'`에만 적용한다.

## 서버 URL 정책

서버는 `confidence >= 0.85`인 이미지 후보만 검토한다. 우선순위는 다음과 같다.

1. 허용된 HTTPS `postUrl`이면 해당 게시물 URL을 사용한다.
2. GitHub에서 유효한 `owner/repository`가 있으면 저장소 URL을 생성한다.
3. 유효한 `handle`이 있으면 플랫폼 프로필 URL을 생성한다.
4. 어느 것도 확정할 수 없으면 메타데이터를 변경하지 않는다.

허용 host와 기본 프로필 URL은 서버 상수로 관리한다.

| platform | metadata key | 허용 host | 프로필 URL |
|---|---|---|---|
| youtube | `유튜브` | `youtube.com`, `www.youtube.com`, `youtu.be` | `https://www.youtube.com/@{handle}` |
| instagram | `인스타그램` | `instagram.com`, `www.instagram.com` | `https://www.instagram.com/{handle}/` |
| threads | `스레드` | `threads.net`, `www.threads.net` | `https://www.threads.net/@{handle}` |
| x | `X` | `x.com`, `www.x.com`, `twitter.com`, `www.twitter.com` | `https://x.com/{handle}` |
| tiktok | `틱톡` | `tiktok.com`, `www.tiktok.com`, `m.tiktok.com` | `https://www.tiktok.com/@{handle}` |
| github | `GitHub` | `github.com`, `www.github.com` | `https://github.com/{handle}` |

`postUrl`은 username 없이 플랫폼 홈으로만 이동하는 URL이면 거부한다. host 검사는 정확히 일치하는 허용 목록으로 제한하여 suffix 우회를 막는다. handle과 GitHub owner/repository는 플랫폼별 허용 문자·길이를 검증한 뒤 URL path segment로 사용한다.

생성된 링크는 기존 `metadata` 객체에 플랫폼 key로 병합한다. 같은 key가 있으면 명시적 AI 재분석 결과로 교체하고, 다른 사용자 key는 보존한다. 후보가 없거나 검증을 통과하지 못하면 기존 key를 자동 삭제하지 않는다.

## HEIC 로컬 미리보기

### 원인

현재 웹은 모든 선택 파일에 `URL.createObjectURL(file)`을 적용해 `<img>`에 직접 넣는다. Chrome 등 HEIC를 디코딩하지 못하는 브라우저에서는 유효한 blob URL이어도 이미지를 표시할 수 없다. 서버 썸네일 생성은 저장 후에만 실행되므로 선택 단계 미리보기를 해결하지 못한다.

### 설계

- MIME type이 `image/heic`/`image/heif`이거나 파일명이 `.heic`/`.heif`로 끝나는 파일만 브라우저 디코더를 지연 로딩한다.
- 이미 API에서 검증된 `heic-decode`를 web workspace의 명시적 의존성으로 추가하고 HEIC 선택 시에만 dynamic import한다.
- 디코딩된 RGBA를 canvas에 그린 뒤 최대 320px 미리보기 JPEG blob으로 변환해 로컬 object URL을 만든다.
- 업로드 payload는 변환 blob이 아닌 사용자가 선택한 원본 `File`을 계속 사용한다.
- 미리보기 생성 중에는 파일명과 `HEIC 미리보기 준비 중…`을 표시한다. 실패하면 깨진 `<img>` 대신 `HEIC` 플레이스홀더를 표시하되 원본 저장은 허용한다.
- 파일 제거·컴포넌트 unmount 시 원본 및 파생 미리보기 object URL을 모두 revoke한다. 비동기 디코딩이 제거 후 완료되면 생성된 URL을 즉시 revoke하고 상태에 추가하지 않는다.

HEIC decoder는 큰 의존성이므로 일반 이미지 초기 번들에 포함하지 않는다. build 결과에서 별도 lazy chunk로 분리되는지 확인한다.

## 저장 완료 후 모달 닫기

`ImageUpload` 완료 callback을 단순 신호에서 결과 요약으로 바꾼다.

```ts
interface UploadSummary {
  successCount: number;
  failureCount: number;
}
```

- `북마크 추가` 모달은 한 차례 저장 큐의 `successCount > 0 && failureCount === 0`이면 목록·카테고리 query를 invalidate하고 성공 toast를 한 번만 표시한 뒤 모달을 닫는다.
- 한 건이라도 실패하면 모달을 유지하고 실패 항목의 재시도 버튼을 보존한다.
- 재시도 후 모든 항목이 성공하면 같은 조건으로 닫는다.
- PWA 공유 화면은 결과 요약을 받되 현재처럼 사용자가 `완료`를 누를 때까지 화면을 유지한다.
- 업로드 중에는 기존처럼 모달 닫기·탭 전환을 차단한다.

## 오류 처리

- AI `source` 스키마 오류: 기존 AI 분석 실패 경로를 따른다.
- source confidence 미달·플랫폼 검증 실패: 제목·요약·태그·카테고리는 정상 적용하고 출처 메타데이터만 생략한다. warning에는 bookmark id와 실패 단계만 남긴다.
- 출처 링크를 만든 후 범용 `bookmarkMetadataSchema`가 실패하면 출처 key만 생략한다.
- HEIC 로컬 디코딩 실패: 플레이스홀더를 표시하고 원본 저장 경로는 계속 허용한다.
- 부분 업로드 실패: 성공 항목은 되돌리지 않고 실패 항목만 재시도한다.

## 테스트와 수용 기준

### 자동 테스트

- AI: 여섯 플랫폼 후보 parse, nullable 후보, strict JSON Schema required, 프롬프트의 추측 금지
- API: 0.85 경계, 링크 북마크에 미적용, host allowlist, HTTPS 제한, post URL 우선, 프로필 fallback, GitHub repository 우선, 잘못된 handle/path 거부, 사용자 metadata 보존
- web HEIC: 일반 이미지는 기존 blob URL, HEIC는 파생 preview URL, 원본 `File` 업로드, 실패 placeholder, URL revoke
- web modal: 전체 성공 시 닫기, 부분 실패 시 유지, 재시도 전체 성공 시 닫기, toast/query invalidate 횟수
- 기존 이미지 카드·상세는 새 메타데이터를 전용 분기 없이 렌더링

### 수동 확인

- 유튜브·인스타그램·스레드·X·틱톡 화면의 handle이 선명한 이미지를 재분석해 해당 프로필 링크가 생김
- 게시물 URL이 직접 표시된 이미지는 프로필보다 게시물로 이동함
- GitHub `owner/repository`가 선명한 이미지는 저장소로, username만 선명한 이미지는 프로필로 이동함
- 표시명·로고만 있는 이미지에는 출처 링크가 생기지 않음
- Chrome에서 HEIC 선택 즉시 실제 내용 미리보기가 표시되고 저장된 원본 MIME/파일명은 HEIC로 보존됨
- 여러 장이 모두 성공하면 모달이 닫히고, 한 장이 실패하면 재시도 UI가 남음

`bun run typecheck && bun run lint && bun run test && bun run build`가 전부 통과해야 완료다.
