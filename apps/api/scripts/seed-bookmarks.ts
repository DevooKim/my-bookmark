import "../src/lib/load-env";
import { createSupabaseAdminClient } from "../src/lib/supabase";

// Seeded bookmarks use this host so --clean can remove them without touching
// real data (bookmarks.url is unique per user, so reruns require --clean).
const SEED_URL_PREFIX = "https://seed.my-bookmark.test/article/";

const TOPICS = [
  "React 19 서버 컴포넌트 정리",
  "Postgres 인덱스 튜닝 노트",
  "TypeScript 타입 추론 깊이 보기",
  "Tailwind CSS v4 마이그레이션",
  "Express 5 에러 핸들링",
  "Supabase RLS 실전 패턴",
  "Web Push 구독 수명 주기",
  "PWA 오프라인 전략 비교",
  "Vite 빌드 최적화 체크리스트",
  "keyset 페이지네이션의 함정",
];

const DESCRIPTIONS = [
  "스크롤 성능 검증용 시드 데이터입니다. 두 줄 클램프 렌더링을 확인하기 위해 설명을 충분히 길게 채워 넣었습니다.",
  "리스트 가상화가 측정 기반으로 동작하는지 확인하는 카드입니다.",
  null,
];

function parseArgs(argv: string[]): {
  count: number;
  email: string;
  clean: boolean;
} {
  let count = 1000;
  let email = process.env["TEST_EMAIL"];
  let clean = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--count") {
      count = Number(argv[i + 1]);
      i += 1;
    } else if (argv[i] === "--email") {
      email = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--clean") {
      clean = true;
    }
  }
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("--count must be a positive integer");
  }
  if (!email) {
    throw new Error("--email <address> or TEST_EMAIL env is required");
  }
  return { count, email, clean };
}

async function findUserIdByEmail(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  email: string,
): Promise<string> {
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) {
      throw error;
    }
    const match = data.users.find(
      (user) => user.email?.toLowerCase() === email.toLowerCase(),
    );
    if (match) {
      return match.id;
    }
    if (data.users.length < 200) {
      throw new Error(`No auth user found for email: ${email}`);
    }
    page += 1;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabase = createSupabaseAdminClient();
  const userId = await findUserIdByEmail(supabase, args.email);

  const { error: deleteError, count: deletedCount } = await supabase
    .from("bookmarks")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .like("url", `${SEED_URL_PREFIX}%`);
  if (deleteError) {
    throw deleteError;
  }
  console.log(`Removed ${deletedCount ?? 0} previously seeded bookmarks`);

  if (args.clean) {
    return;
  }

  const { data: categories, error: categoriesError } = await supabase
    .from("categories")
    .select("id")
    .eq("user_id", userId);
  if (categoriesError) {
    throw categoriesError;
  }
  const categoryIds = (categories ?? []).map((row) => row.id);

  const now = Date.now();
  const rows = Array.from({ length: args.count }, (_, index) => {
    const topic = TOPICS[index % TOPICS.length];
    const description = DESCRIPTIONS[index % DESCRIPTIONS.length];
    const categoryId =
      categoryIds.length > 0 && index % 3 !== 0
        ? categoryIds[index % categoryIds.length]
        : null;
    return {
      user_id: userId,
      url: `${SEED_URL_PREFIX}${String(index + 1).padStart(4, "0")}`,
      title: `${topic} #${index + 1}`,
      description,
      site_name: "seed.my-bookmark.test",
      favicon_url: null,
      og_image_url: null,
      category_id: categoryId,
      ai_status: "idle",
      // spread over the past to exercise keyset pagination ordering
      created_at: new Date(now - index * 60_000).toISOString(),
    };
  });

  const batchSize = 500;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const { error: insertError } = await supabase
      .from("bookmarks")
      .insert(batch);
    if (insertError) {
      throw insertError;
    }
    console.log(
      `Inserted ${Math.min(offset + batchSize, rows.length)}/${rows.length}`,
    );
  }

  console.log(`Seeded ${rows.length} bookmarks for ${args.email}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
