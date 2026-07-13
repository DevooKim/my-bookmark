# 02. 데이터베이스

Supabase Postgres. 마이그레이션은 supabase CLI(`supabase/migrations/*.sql`)로 관리한다.

## 워크플로

```bash
supabase login && supabase link --project-ref <ref>   # 최초 1회
supabase migration new <name>                          # SQL 파일 생성
supabase db push                                       # 원격 적용
```

로컬 Postgres(`supabase start`)는 선택사항 — 1인 프로젝트이므로 원격 dev 프로젝트에 직접 push해도 된다.

## 스키마 (마이그레이션 누적 기준)

```sql
-- updated_at 자동 갱신
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 50),
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);

create table public.bookmarks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null default 'link' check (kind in ('link', 'image')),
  url          text,
  title        text,
  description  text,
  site_name    text,
  favicon_url  text,
  og_image_url text,
  image_original_path  text,
  image_thumbnail_path text,
  image_mime_type      text,
  image_file_size      bigint,
  image_width          int,
  image_height         int,
  image_filename       text,
  category_id  uuid references public.categories(id) on delete set null,
  tags         text[] not null default '{}',
  -- idle: AI 미사용(수동/미지정), pending: 분류 대기/진행, done: AI 분류 완료, failed: 분류 실패(재시도 가능)
  ai_status    text not null default 'idle'
               check (ai_status in ('idle','pending','done','failed')),
  ai_model     text,                        -- 분류에 실사용된 OpenRouter 모델 id (free text, raw 표시)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (
    (kind = 'link' and url ~ '^https?://' and image_original_path is null)
    or
    (kind = 'image' and url is null and image_original_path is not null and image_thumbnail_path is not null)
  )
);
create index bookmarks_user_created_idx on public.bookmarks (user_id, created_at desc, id desc);
create unique index bookmarks_user_url_unique_idx on public.bookmarks (user_id, url) where kind = 'link';
create index bookmarks_user_kind_created_idx on public.bookmarks (user_id, kind, created_at desc, id desc);
create index bookmarks_category_idx     on public.bookmarks (category_id);
create trigger bookmarks_updated_at before update on public.bookmarks
  for each row execute function public.set_updated_at();

create table public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,                -- 예: "iPhone 단축어"
  key_hash     text not null unique,         -- sha256 hex. 원문은 저장하지 않음
  key_prefix   text not null,                -- 표시용 앞부분 (예: "bm_3fa9")
  last_used_at timestamptz,
  revoked_at   timestamptz,                  -- null = 유효
  created_at   timestamptz not null default now()
);

create table public.ai_usage_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  provider    text not null,                -- 모델 id의 vendor prefix (예: "google"), 실패 시 "openrouter"
  model       text not null,                -- 성공 시 실사용 모델, 실패 시 "@preset/my-bookmark"
  bookmark_id uuid references public.bookmarks(id) on delete set null,
  status      text not null check (status in ('success', 'failed')),
  error_code  text,
  duration_ms int,
  is_byok     boolean,                     -- OpenRouter 응답 usage.is_byok (실패 시 null)
  created_at  timestamptz not null default now()
);
create index ai_usage_events_user_created_idx
  on public.ai_usage_events (user_id, created_at desc);

create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create table public.reminders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  bookmark_id uuid not null references public.bookmarks(id) on delete cascade,
  remind_at   timestamptz not null,
  note        text,
  status      text not null default 'pending'
              check (status in ('pending','sent','cancelled')),
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index reminders_due_idx on public.reminders (status, remind_at);
```

## RLS (같은 마이그레이션에 포함)

Express는 secret key로 접근하므로 RLS를 bypass한다. RLS는 **publishable key가 유출되거나 클라이언트가 DB에 직접 붙는 사고에 대비한 심층 방어**다. 전 테이블 동일 패턴:

```sql
alter table public.categories         enable row level security;
alter table public.bookmarks          enable row level security;
alter table public.api_keys           enable row level security;
alter table public.ai_usage_events    enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminders          enable row level security;

-- 테이블마다 반복 (categories 예시)
create policy "owner_all" on public.categories
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
```

`(select auth.uid())` 형태는 Supabase 권장 패턴(행마다 재평가 방지). anon 롤에는 아무 정책도 주지 않는다.

## 모델링 노트

- **미분류 북마크** = `category_id IS NULL`. 별도 "미분류" 카테고리 행을 만들지 않는다. API에서 미분류 필터는 `categoryId=none`으로 표현 (03-api).
- **항목 종류**: 링크와 이미지는 같은 `bookmarks` 목록·카테고리·태그·리마인더 표면을 공유하며 `kind`로 구분한다. 링크는 `url` 필수, 이미지는 `url=null`이고 private Storage 경로와 파일 메타데이터가 필수다.
- **URL 중복**: 링크에만 partial unique index `(user_id, url) where kind='link'`를 적용한다. 같은 URL 재등록 시 API는 409 + 기존 북마크를 돌려준다. URL은 저장 전 정규화한다: trim, fragment(#…) 제거, 트래킹 파라미터(`utm_*`, `fbclid`, `gclid`) 제거. 과도한 정규화(쿼리 전체 제거 등)는 하지 않는다.
- **카테고리 삭제** → 소속 북마크는 `on delete set null`로 미분류가 된다. UI에서 이를 안내.
- **`ai_status` 상태 전이**: `idle → pending`(AI 재분류 요청), `pending → done | failed`, `failed → pending`(재시도). `done/pending` 북마크의 카테고리를 사용자가 수동 변경하면 `idle`로 되돌린다 (사용자 판단이 AI 결과를 덮음).
- **태그**는 별도 조인 테이블 대신 `bookmarks.tags text[]`에 저장한다. 북마크당 최대 5개를 제약으로 강제하고, 배열 검색을 위해 GIN 인덱스를 둔다. `search_bookmarks` 함수는 API가 인증에서 얻은 `p_user_id`를 필수 조건으로 적용하고 카테고리·커서 조건과 제목·URL·설명·태그 부분 검색을 한 번에 처리한다. 함수 실행 권한은 `service_role`에만 부여한다.
- **AI 분류는 서버 env(`OPEN_ROUTER_API_KEY`)로 동작한다** — provider별 키 저장 테이블은 없다(`0008_openrouter_preset.sql`에서 `ai_settings` drop). 모델 선택·폴백·파라미터는 OpenRouter의 preset(`@preset/my-bookmark`)이 담당하므로 DB에 모델 카탈로그나 우선순위 컬럼이 없다.
- **ai_usage_events**는 분류 시도 1건당 1행이다(성공/실패 모두 기록). 토큰·비용은 로컬에 저장하지 않는다 — 공식 수치는 OpenRouter `GET /key`(계정 사용액)와 openrouter.ai activity 페이지가 원본이다.
- **reminders**는 단발성(one-shot). 반복 규칙은 추후 컬럼 추가로 확장 (`rrule text` 예약 — 지금은 만들지 않음).
- 사용자 계정은 Supabase 대시보드에서 수동 생성 1개뿐 — `profiles` 테이블 불필요.

## 이미지 Storage

- `bookmark-images` 버킷은 private이며 파일당 20MB, JPEG/PNG/WebP/GIF/HEIC/HEIF만 허용한다.
- 경로는 `{userId}/{bookmarkId}/original.{ext}`와 `{userId}/{bookmarkId}/thumbnail.webp`다. DB에는 private 경로만 저장하고 클라이언트에는 짧은 수명의 signed URL만 반환한다.
- 목록은 signed 썸네일만, 상세는 signed 원본까지 반환한다. 원본·signed URL은 서비스 워커 API/asset 캐시에 직접 저장하지 않는다.
- 원본과 썸네일은 항목 삭제 때 함께 제거한다. AI용 2048px JPEG와 OCR 원문은 영구 저장하지 않는다.

## 시드

시드 데이터 없음. 기본 카테고리도 미리 만들지 않는다 (AI가 새 카테고리를 제안하거나 사용자가 직접 생성).
