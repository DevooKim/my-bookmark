# Apple 스타일 UI 전면 개편 설계

## 목표

기존 북마크, 리마인더, 설정, 인증 기능과 API 흐름을 그대로 유지하면서 앱 전체를 차분하고 직접적인 Apple식 인터페이스로 통일한다. 결과는 iPhone PWA와 데스크톱 브라우저 모두에서 익숙하고 빠르며, 라이트·다크 모드와 접근성 설정에 자연스럽게 적응해야 한다.

## 디자인 원칙

- 시스템 폰트와 크기별 tracking/leading으로 읽기 계층을 만든다.
- 떠 있는 헤더, 하단 탭, 시트에만 반투명 소재를 사용하고 콘텐츠 표면은 불투명하게 유지한다.
- 모든 버튼은 pointer-down 즉시 축소 피드백을 주며 입력을 전환 중 잠그지 않는다.
- 기본 동작은 임계 감쇠에 가까운 짧은 이동으로 표현하고 장식적 bounce는 사용하지 않는다.
- `prefers-reduced-motion`, `prefers-reduced-transparency`, `prefers-contrast`에 각각 대응한다.
- 최소 44px 터치 타깃, 명확한 focus ring, safe-area 여백을 모든 모바일 chrome에 적용한다.

## 화면 구조

### 앱 셸

배경은 단색 위에 아주 약한 blue 계열 ambient gradient만 둔다. 데스크톱 헤더는 상단에서 여백을 둔 capsule 형태의 glass surface로 띄우고 브랜드와 우측 햄버거만 표시한다. 햄버거 팝오버에 라이브러리·리마인더·설정·로그아웃을 통합한다. 모바일은 상단 헤더를 제거하고 콘텐츠 위에 떠 있는 둥근 하단 바에 라이브러리·리마인더·추가·설정을 배치하며 `추가`를 blue primary action으로 강조한다. 브랜드는 데스크톱 헤더에서 책갈피 아이콘과 `My Bookmark` wordmark를 유지한다.

### 라이브러리

페이지 hero와 `library-toolbar`는 제거하고 앱 셸 바로 아래에 검색 입력과 카테고리 필터만 둔다. 추가는 모바일 하단 바와 데스크톱 우측 하단 원형 floating action으로 분리한다. 북마크 카드는 제목, AI 요약, 도메인/카테고리, 태그 순서로 읽히게 한다. 태그는 모바일에서 작은 읽기 전용 뱃지로, 데스크톱에서는 같은 시각 크기의 검색 버튼으로 제공하며 충분한 명도 대비를 유지한다. 카드 메뉴는 외부 클릭·Escape·액션 선택 시 닫히고, 카테고리 변경은 편집 폼에 포함한다. favicon과 메뉴는 시선을 뺏지 않도록 절제한다. hover 가능한 장치에서는 카드가 1px 떠오르고, touch에서는 누르는 동안만 축소된다. 빈 상태와 로딩 상태도 같은 surface 언어를 쓴다.

### 리마인더와 설정

리마인더는 시간 정보를 accent tile로 분리해 스캔 가능성을 높인다. 설정은 각 기능을 독립적인 inset group으로 유지하되 동일한 section header, border, spacing을 공유하고 최하단 계정 section에 로그아웃을 둔다. 파괴적 액션은 red tint만 사용하고 과도한 경고색 면적은 피한다.

### 로그인과 모달

로그인은 브랜드 표식, 짧은 설명, 폼을 한 장의 frosted card로 구성한다. 모달은 모바일에서 bottom sheet, 데스크톱에서 중앙 dialog로 동일한 진입·퇴장 경로를 사용한다. 추가·편집 모달 surface는 blur 없는 불투명 배경으로 유지하고 바깥 scrim에만 3px의 약한 backdrop blur를 적용한다. scrim 직접 클릭은 닫힘으로 처리하고 surface 내부 클릭은 유지한다. scrim과 surface가 함께 materialize되며 reduced motion에서는 opacity 전환만 남긴다.

## 구현 경계

새 animation 라이브러리나 상태 관리 라이브러리를 추가하지 않는다. 공통 시각 규칙은 `styles.css`의 semantic utility class로 제공하고, 라우트는 구조와 의미를 표현하는 클래스만 사용한다. API 호출, query key, mutation, virtualization, PWA 동작은 변경하지 않는다.

## 검증

- 컴포넌트 테스트로 공통 app shell, 명시적 화면 landmark, dialog semantics를 고정한다.
- `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build` 전체 루프를 통과한다.
- 실제 브라우저에서 375px 모바일과 데스크톱, 라이트/다크, reduced motion을 확인하고 주요 화면을 캡처한다.
