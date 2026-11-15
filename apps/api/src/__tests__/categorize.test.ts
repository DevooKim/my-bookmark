import type {
  AiProvider,
  AnalyzeResult,
  PlaceCandidate,
} from "@my-bookmark/ai";
import { describe, expect, it, vi } from "vitest";
import {
  applyCategorizeResult,
  categorizeBookmark,
} from "../services/categorize";
import type { PlaceGeocoder } from "../services/place-geocoder";

interface PlaceRow extends Record<string, unknown> {
  position: number;
  name: string;
  geocode_status: string;
}

class FakeDb {
  categories = [{ id: "cat-dev", name: "개발" }];
  bookmark = {
    id: "bookmark",
    user_id: "user",
    kind: "link" as "link" | "image",
    url: "https://example.com/article" as string | null,
    image_original_path: null as string | null,
    title: "기존 메타데이터 제목" as string | null,
    description: null as string | null,
    site_name: null as string | null,
    category_id: null as string | null,
    tags: ["기존 태그"],
    metadata: { 예약메모: "창가 자리" } as Record<string, string>,
    ai_status: "pending" as "idle" | "pending" | "done" | "failed",
    ai_model: null as string | null,
    places_analyzed_at: null as string | null,
  };
  bookmarkUpdates: Record<string, unknown>[] = [];
  places: PlaceRow[] = [];
  placeInsertError: { message: string } | null = null;

  from(table: string) {
    if (table === "bookmark_places") {
      return {
        delete: () => ({
          eq: () => ({
            eq: () => {
              this.places = [];
              return Promise.resolve({ data: null, error: null });
            },
          }),
        }),
        insert: (rows: Record<string, unknown>[]) => {
          if (this.placeInsertError) {
            return Promise.resolve({
              data: null,
              error: this.placeInsertError,
            });
          }
          this.places.push(
            ...rows.map((row) => ({
              ...row,
              // biome-ignore lint/complexity/useLiteralKeys: index access is required by noPropertyAccessFromIndexSignature.
              position: Number(row["position"]),
              // biome-ignore lint/complexity/useLiteralKeys: index access is required by noPropertyAccessFromIndexSignature.
              name: String(row["name"]),
              // biome-ignore lint/complexity/useLiteralKeys: index access is required by noPropertyAccessFromIndexSignature.
              geocode_status: String(row["geocode_status"]),
            })),
          );
          return Promise.resolve({ data: null, error: null });
        },
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                order: () =>
                  Promise.resolve({
                    data: this.places
                      .map((row, index) => ({ ...row, id: `place-${index}` }))
                      .filter((row) => row.geocode_status === "pending"),
                    error: null,
                  }),
              }),
            }),
          }),
        }),
        update: (values: Record<string, unknown>) => ({
          eq: (_field: string, id: string) => ({
            eq: () => {
              const index = Number(id.replace("place-", ""));
              const row = this.places[index];
              if (row) {
                Object.assign(row, values);
              }
              return Promise.resolve({ data: null, error: null });
            },
          }),
        }),
      };
    }
    if (table === "bookmarks") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: this.bookmark, error: null }),
            }),
          }),
        }),
        update: (values: Record<string, unknown>) => {
          this.bookmarkUpdates.push(values);
          // places_analyzed_at 되돌리기는 상태 조건 없이 user_id/id만으로 적용된다.
          if (
            Object.keys(values).length === 1 &&
            Reflect.get(values, "places_analyzed_at") === null
          ) {
            this.bookmark.places_analyzed_at = null;
          }
          return {
            eq: () => ({
              eq: () => ({
                eq: (_field: string, value: string) => {
                  const matched = value === this.bookmark.ai_status;
                  if (matched) {
                    Object.assign(this.bookmark, values);
                  }
                  return Object.assign(
                    Promise.resolve({ data: null, error: null }),
                    {
                      select: () =>
                        Promise.resolve({
                          data: matched ? [{ id: this.bookmark.id }] : [],
                          error: null,
                        }),
                    },
                  );
                },
              }),
            }),
          };
        },
      };
    }
    return {
      insert: (values: Record<string, unknown>) => ({
        select: () => ({
          single: () => {
            const category = {
              id: `cat-${this.categories.length + 1}`,
              // biome-ignore lint/complexity/useLiteralKeys: index access is required by noPropertyAccessFromIndexSignature.
              name: String(values["name"]),
            };
            this.categories.push(category);
            return Promise.resolve({ data: { id: category.id }, error: null });
          },
        }),
      }),
      select: () => ({
        eq: () => Promise.resolve({ data: this.categories, error: null }),
      }),
    };
  }
}

const analysis = (category: AnalyzeResult["category"]): AnalyzeResult => ({
  category,
  summaryTitle: "웹 접근성 실전 안내",
  summary:
    "웹 접근성의 핵심 원칙을 실무 예제로 설명한다. 폼 라벨과 키보드 내비게이션 개선 방법을 다룬다.",
  tags: ["웹 접근성", "프론트엔드", "사용자 경험"],
});

const successResult: AnalyzeResult = {
  category: { type: "existing", categoryId: "cat-dev", confidence: 0.9 },
  summaryTitle: "웹 접근성 실전 안내",
  summary: "핵심 요약.",
  tags: ["웹 접근성", "프론트엔드", "사용자 경험"],
};

describe("applyCategorizeResult", () => {
  const place = (
    name: string,
    overrides: Partial<PlaceCandidate> = {},
  ): PlaceCandidate => ({
    name,
    locality: "서울 성동구",
    countryCode: "KR",
    confidence: 0.9,
    ...overrides,
  });

  async function apply(
    db: FakeDb,
    places: PlaceCandidate[] | null | undefined,
    tags?: string[],
    placeGeocoder: PlaceGeocoder | null = null,
  ) {
    await applyCategorizeResult(
      db,
      "user",
      "bookmark",
      db.categories,
      {
        ...analysis({ type: "none" }),
        ...(tags ? { tags } : {}),
        places,
      },
      "google/gemini-3.1-flash-lite-20260507",
      db.bookmark.metadata,
      "link",
      placeGeocoder,
    );
  }

  it("stores every confident place in order with a geocode status by country", async () => {
    const db = new FakeDb();
    await apply(db, [
      place("호랑이식당 성수점"),
      place("% Arabica 嵐山", { locality: "Kyoto", countryCode: "JP" }),
      place("국가 미상 카페", { locality: null, countryCode: null }),
    ]);

    expect(db.places).toEqual([
      {
        user_id: "user",
        bookmark_id: "bookmark",
        position: 0,
        name: "호랑이식당 성수점",
        locality: "서울 성동구",
        country_code: "KR",
        geocode_status: "pending",
      },
      {
        user_id: "user",
        bookmark_id: "bookmark",
        position: 1,
        name: "% Arabica 嵐山",
        locality: "Kyoto",
        country_code: "JP",
        geocode_status: "skipped",
      },
      {
        user_id: "user",
        bookmark_id: "bookmark",
        position: 2,
        name: "국가 미상 카페",
        locality: null,
        country_code: null,
        geocode_status: "pending",
      },
    ]);
    expect(db.bookmarkUpdates.at(-1)).not.toHaveProperty("metadata");
  });

  it("drops low-confidence places and duplicate names", async () => {
    const db = new FakeDb();
    await apply(db, [
      place("아마도 식당", { confidence: 0.849 }),
      place("신죠오 사사게요"),
      place("신죠오·사사게요", { locality: "다른 동네" }),
      place("이키야", { confidence: 0.85 }),
    ]);

    expect(db.places.map((row) => [row.position, row.name])).toEqual([
      [0, "신죠오 사사게요"],
      [1, "이키야"],
    ]);
  });

  it("replaces the previous places when the bookmark is analyzed again", async () => {
    const db = new FakeDb();
    await apply(db, [place("옛날 식당"), place("옛날 카페")]);
    db.bookmark.ai_status = "pending";
    await apply(db, [place("새 식당")]);
    expect(db.places.map((row) => row.name)).toEqual(["새 식당"]);

    db.bookmark.ai_status = "pending";
    await apply(db, []);
    expect(db.places).toEqual([]);
  });

  it("leaves places untouched when the pending update did not apply", async () => {
    const db = new FakeDb();
    await apply(db, [place("기존 식당")]);
    db.bookmark.ai_status = "idle";
    await apply(db, [place("덮어쓰면 안 되는 식당")]);
    expect(db.places.map((row) => row.name)).toEqual(["기존 식당"]);
  });

  it("keeps the finished analysis when saving places fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = new FakeDb();
    db.placeInsertError = { message: "insert failed" };
    await apply(db, [place("호랑이식당")]);
    expect(db.bookmark.ai_status).toBe("done");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  describe("places_analyzed_at", () => {
    it("is recorded in the same UPDATE that marks the bookmark done", async () => {
      const db = new FakeDb();
      await apply(db, [place("호랑이식당")]);
      const doneUpdate = db.bookmarkUpdates.find(
        (values) => Reflect.get(values, "ai_status") === "done",
      );
      const doneAnalyzedAt = doneUpdate
        ? Reflect.get(doneUpdate, "places_analyzed_at")
        : undefined;
      expect(doneAnalyzedAt).toEqual(expect.any(String));
      expect(Number.isNaN(Date.parse(String(doneAnalyzedAt)))).toBe(false);
      expect(db.bookmark.places_analyzed_at).toBe(doneAnalyzedAt);
    });

    it("is recorded even when the analysis found no places", async () => {
      const db = new FakeDb();
      await apply(db, []);
      expect(db.places).toEqual([]);
      expect(db.bookmark.places_analyzed_at).toEqual(expect.any(String));
    });

    it("is not recorded when the pending update did not apply", async () => {
      const db = new FakeDb();
      db.bookmark.ai_status = "idle";
      await apply(db, [place("덮어쓰면 안 되는 식당")]);
      expect(db.bookmark.places_analyzed_at).toBeNull();
    });

    it("is reset when saving places fails so the backfill can retry", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const db = new FakeDb();
      db.placeInsertError = { message: "insert failed" };
      await apply(db, [place("호랑이식당")]);
      expect(db.bookmark.ai_status).toBe("done");
      expect(db.bookmark.places_analyzed_at).toBeNull();
      warn.mockRestore();
    });

    it("stays recorded when only geocoding fails", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const db = new FakeDb();
      await apply(db, [place("호랑이식당")], undefined, {
        geocode: vi.fn().mockRejectedValue(new Error("network")),
      });
      expect(db.places).toHaveLength(1);
      expect(db.bookmark.places_analyzed_at).toEqual(expect.any(String));
      warn.mockRestore();
    });
  });

  describe("geocoding", () => {
    const resolved = {
      status: "resolved" as const,
      lat: 37.5,
      lng: 127.04,
      address: "서울 성동구 성수동",
      roadAddress: "서울 성동구 아차산로",
    };

    it("resolves domestic places, marks misses not_found, and skips overseas places", async () => {
      const db = new FakeDb();
      const geocode = vi
        .fn()
        .mockResolvedValueOnce(resolved)
        .mockResolvedValueOnce({ status: "not_found" });
      await apply(
        db,
        [
          place("호랑이식당"),
          place("없는 가게"),
          place("% Arabica", { countryCode: "JP", locality: "Kyoto" }),
        ],
        undefined,
        { geocode },
      );

      expect(geocode).toHaveBeenCalledTimes(2);
      expect(geocode).toHaveBeenNthCalledWith(1, {
        name: "호랑이식당",
        locality: "서울 성동구",
      });
      expect(db.places.map((row) => row.geocode_status)).toEqual([
        "resolved",
        "not_found",
        "skipped",
      ]);
      expect(db.places[0]).toMatchObject({
        lat: 37.5,
        lng: 127.04,
        address: "서울 성동구 성수동",
        road_address: "서울 성동구 아차산로",
      });
    });

    it("leaves places pending when no geocoder is configured", async () => {
      const db = new FakeDb();
      await apply(db, [place("호랑이식당")]);
      expect(db.places.map((row) => row.geocode_status)).toEqual(["pending"]);
    });

    it("keeps the analysis and leaves the place pending when geocoding fails", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const db = new FakeDb();
      const geocode = vi.fn().mockRejectedValue(new Error("network down"));
      await apply(db, [place("호랑이식당")], undefined, { geocode });

      expect(db.bookmark.ai_status).toBe("done");
      expect(db.places.map((row) => row.geocode_status)).toEqual(["pending"]);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  it("removes a previously auto-generated Naver Map search link only", async () => {
    const generated = new FakeDb();
    generated.bookmark.metadata = {
      예약메모: "창가 자리",
      네이버지도: "https://map.naver.com/p/search/%EC%8B%9D%EB%8B%B9",
    };
    await apply(generated, []);
    expect(generated.bookmarkUpdates.at(-1)?.["metadata"]).toEqual({
      예약메모: "창가 자리",
    });

    const custom = new FakeDb();
    custom.bookmark.metadata = {
      네이버지도: "https://naver.me/abcdef",
    };
    await apply(custom, []);
    expect(custom.bookmarkUpdates.at(-1)).not.toHaveProperty("metadata");
  });

  it("removes exact normalized names of every place from generated tags", async () => {
    const db = new FakeDb();
    await apply(
      db,
      [
        place("신죠오 사사게요 천호점", { locality: "서울 강동구" }),
        place("이키야 나고야식 미소카츠"),
      ],
      [
        "신죠오 사사게요 천호점",
        "신죠오·사사게요-천호점",
        "이키야 나고야식 미소카츠",
        "미소카츠",
        "천호",
      ],
    );

    expect(db.bookmarkUpdates.at(-1)).toMatchObject({
      title: "웹 접근성 실전 안내",
      tags: ["미소카츠", "천호"],
      ai_status: "done",
    });
  });

  it("adds a verified GitHub source only for image bookmarks", async () => {
    const source: AnalyzeResult["source"] = {
      platform: "github",
      handle: "DevooKim",
      postUrl: null,
      repository: "DevooKim/my-bookmark",
      confidence: 0.9,
    };
    const imageDb = new FakeDb();
    await applyCategorizeResult(
      imageDb,
      "user",
      "bookmark",
      imageDb.categories,
      { ...analysis({ type: "none" }), source },
      "google/gemini-3.1-flash-lite-20260507",
      imageDb.bookmark.metadata,
      "image",
    );
    expect(imageDb.bookmarkUpdates.at(-1)).toMatchObject({
      metadata: {
        예약메모: "창가 자리",
        GitHub: "https://github.com/DevooKim/my-bookmark",
      },
    });

    const linkDb = new FakeDb();
    await applyCategorizeResult(
      linkDb,
      "user",
      "bookmark",
      linkDb.categories,
      { ...analysis({ type: "none" }), source },
      "google/gemini-3.1-flash-lite-20260507",
      linkDb.bookmark.metadata,
      "link",
    );
    expect(linkDb.bookmarkUpdates.at(-1)).not.toHaveProperty("metadata");
  });

  it("keeps the source metadata and stores places for an image", async () => {
    const db = new FakeDb();
    await applyCategorizeResult(
      db,
      "user",
      "bookmark",
      db.categories,
      {
        ...analysis({ type: "none" }),
        places: [place("호랑이식당")],
        source: {
          platform: "instagram",
          handle: "tiger.restaurant",
          postUrl: null,
          repository: null,
          confidence: 0.9,
        },
      },
      "google/gemini-3.1-flash-lite-20260507",
      db.bookmark.metadata,
      "image",
    );

    expect(db.bookmarkUpdates.at(-1)).toMatchObject({
      metadata: {
        예약메모: "창가 자리",
        인스타그램: "https://www.instagram.com/tiger.restaurant/",
      },
    });
    expect(db.bookmarkUpdates.at(-1)?.["metadata"]).not.toHaveProperty(
      "네이버지도",
    );
    expect(db.places).toHaveLength(1);
  });

  it("finishes analysis while omitting an invalid source", async () => {
    const db = new FakeDb();
    await applyCategorizeResult(
      db,
      "user",
      "bookmark",
      db.categories,
      {
        ...analysis({ type: "none" }),
        source: {
          platform: "github",
          handle: null,
          postUrl: "https://github.com.evil.test/owner/repo",
          repository: null,
          confidence: 0.99,
        },
      },
      "google/gemini-3.1-flash-lite-20260507",
      db.bookmark.metadata,
      "image",
    );

    expect(db.bookmarkUpdates.at(-1)).toMatchObject({ ai_status: "done" });
    expect(db.bookmarkUpdates.at(-1)).not.toHaveProperty("metadata");
  });

  it("applies category, summary title, and tags in one pending-guarded update", async () => {
    const db = new FakeDb();
    await applyCategorizeResult(
      db,
      "user",
      "bookmark",
      db.categories,
      analysis({ type: "none" }),
      "google/gemini-3.1-flash-lite-20260507",
    );

    expect(db.bookmarkUpdates).toEqual([
      {
        category_id: null,
        title: "웹 접근성 실전 안내",
        description:
          "웹 접근성의 핵심 원칙을 실무 예제로 설명한다. 폼 라벨과 키보드 내비게이션 개선 방법을 다룬다.",
        tags: ["웹 접근성", "프론트엔드", "사용자 경험"],
        ai_status: "done",
        ai_model: "google/gemini-3.1-flash-lite-20260507",
        places_analyzed_at: expect.any(String),
      },
    ]);
  });

  it("keeps the existing description when the AI omits summary", async () => {
    const db = new FakeDb();
    await applyCategorizeResult(
      db,
      "user",
      "bookmark",
      db.categories,
      {
        category: { type: "none" },
        summaryTitle: "웹 접근성 실전 안내",
        tags: ["웹 접근성", "프론트엔드", "사용자 경험"],
      },
      "google/gemini-3.1-flash-lite-20260507",
    );

    expect(db.bookmarkUpdates).toEqual([
      {
        category_id: null,
        title: "웹 접근성 실전 안내",
        tags: ["웹 접근성", "프론트엔드", "사용자 경험"],
        ai_status: "done",
        ai_model: "google/gemini-3.1-flash-lite-20260507",
        places_analyzed_at: expect.any(String),
      },
    ]);
  });

  it("sets an existing category only when the bookmark is still pending", async () => {
    const db = new FakeDb();
    await applyCategorizeResult(
      db,
      "user",
      "bookmark",
      db.categories,
      analysis({
        type: "existing",
        categoryId: "cat-dev",
        confidence: 0.9,
      }),
      "google/gemini-3.1-flash-lite-20260507",
    );

    expect(db.bookmark).toMatchObject({
      category_id: "cat-dev",
      title: "웹 접근성 실전 안내",
      tags: ["웹 접근성", "프론트엔드", "사용자 경험"],
      ai_status: "done",
    });

    db.bookmark = {
      ...db.bookmark,
      category_id: "manual",
      title: "사용자 제목",
      tags: ["사용자 태그"],
      ai_status: "idle",
    };
    await applyCategorizeResult(
      db,
      "user",
      "bookmark",
      db.categories,
      analysis({
        type: "existing",
        categoryId: "cat-dev",
        confidence: 0.9,
      }),
      "google/gemini-3.1-flash-lite-20260507",
    );
    expect(db.bookmark).toMatchObject({
      category_id: "manual",
      title: "사용자 제목",
      tags: ["사용자 태그"],
      ai_status: "idle",
    });
  });

  it("reuses a same-name category before creating a new category", async () => {
    const db = new FakeDb();
    await applyCategorizeResult(
      db,
      "user",
      "bookmark",
      db.categories,
      analysis({ type: "new", name: " 개발 ", confidence: 0.8 }),
      "google/gemini-3.1-flash-lite-20260507",
    );

    expect(db.categories).toHaveLength(1);
    expect(db.bookmark.category_id).toBe("cat-dev");
  });

  it("rechecks the database before creating a suggested new category", async () => {
    const db = new FakeDb();
    await applyCategorizeResult(
      db,
      "user",
      "bookmark",
      [],
      analysis({ type: "new", name: " 개발 ", confidence: 0.8 }),
      "google/gemini-3.1-flash-lite-20260507",
    );

    expect(db.categories).toHaveLength(1);
    expect(db.bookmark.category_id).toBe("cat-dev");
  });

  it("creates a new category", async () => {
    const db = new FakeDb();
    await applyCategorizeResult(
      db,
      "user",
      "bookmark",
      db.categories,
      analysis({ type: "new", name: "디자인", confidence: 0.8 }),
      "google/gemini-3.1-flash-lite-20260507",
    );
    expect(db.categories.at(-1)).toEqual({ id: "cat-2", name: "디자인" });
    expect(db.bookmark.category_id).toBe("cat-2");
  });

  it("reuses an existing plain-name category when AI proposes an emoji-prefixed name", async () => {
    const db = new FakeDb();
    await applyCategorizeResult(
      db,
      "user",
      "bookmark",
      db.categories,
      analysis({ type: "new", name: "💻 개발", confidence: 0.8 }),
      "google/gemini-3.1-flash-lite-20260507",
    );

    expect(db.categories).toHaveLength(1);
    expect(db.bookmark.category_id).toBe("cat-dev");
  });

  it("reuses an existing emoji-prefixed category when AI proposes a plain name", async () => {
    const db = new FakeDb();
    db.categories = [{ id: "cat-news", name: "📰 뉴스" }];
    await applyCategorizeResult(
      db,
      "user",
      "bookmark",
      db.categories,
      analysis({ type: "new", name: "뉴스", confidence: 0.8 }),
      "google/gemini-3.1-flash-lite-20260507",
    );

    expect(db.categories).toHaveLength(1);
    expect(db.bookmark.category_id).toBe("cat-news");
  });
});

function fakeProvider(categorize: AiProvider["categorize"]): AiProvider {
  return { categorize, validateConnection: vi.fn() };
}

describe("categorizeBookmark", () => {
  it("loads a private image and sends it as an image analysis input", async () => {
    const db = new FakeDb();
    db.bookmark.kind = "image";
    db.bookmark.url = null;
    db.bookmark.image_original_path = "user/bookmark/original.heic";
    const categorize = vi.fn().mockResolvedValue({
      analysis: successResult,
      model: "google/gemini-3.1-flash-lite-20260507",
      isByok: false,
    });
    const imageLoader = vi.fn().mockResolvedValue({
      mimeType: "image/jpeg" as const,
      base64: "AQID",
    });

    await categorizeBookmark({
      db,
      userId: "user",
      bookmarkId: "bookmark",
      provider: fakeProvider(categorize),
      imageLoader,
    });

    expect(imageLoader).toHaveBeenCalledWith({
      originalPath: "user/bookmark/original.heic",
    });
    expect(categorize).toHaveBeenCalledWith({
      kind: "image",
      image: { mimeType: "image/jpeg", base64: "AQID" },
      existingCategories: db.categories,
    });
  });

  it("preserves prior title, tags, and category when the provider is unset", async () => {
    const db = new FakeDb();
    db.bookmark.category_id = "cat-dev";

    await categorizeBookmark({
      db,
      userId: "user",
      bookmarkId: "bookmark",
      provider: null,
      metadataFetcher: vi.fn().mockResolvedValue({
        title: null,
        description: null,
        siteName: null,
        faviconUrl: null,
        ogImageUrl: null,
      }),
    });

    expect(db.bookmark).toMatchObject({
      category_id: "cat-dev",
      title: "기존 메타데이터 제목",
      tags: ["기존 태그"],
      ai_status: "failed",
    });
    expect(db.bookmarkUpdates.at(-1)).toEqual({ ai_status: "failed" });
    expect(db.bookmarkUpdates).not.toContainEqual(
      expect.objectContaining({
        title: "웹 접근성 실전 안내",
      }),
    );
  });

  it("embeds finalized AI fields without changing AI status on embedding failure", async () => {
    const db = new FakeDb();
    const embed = vi.fn().mockRejectedValue(new Error("embedding failed"));
    const provider = fakeProvider(
      vi.fn().mockResolvedValue({
        analysis: successResult,
        model: "google/gemini-3.1-flash-lite-20260507",
        isByok: false,
      }),
    );

    await categorizeBookmark({
      db,
      userId: "user",
      bookmarkId: "bookmark",
      provider,
      embeddingProvider: { embed },
      metadataFetcher: vi.fn().mockResolvedValue({
        title: null,
        description: null,
        siteName: null,
        faviconUrl: null,
        ogImageUrl: null,
      }),
    });
    await vi.waitFor(() => expect(embed).toHaveBeenCalled());

    expect(embed).toHaveBeenCalledWith({
      text: "웹 접근성 실전 안내\n핵심 요약.\n웹 접근성 프론트엔드 사용자 경험",
    });
    expect(db.bookmark.ai_status).toBe("done");
    expect(db.bookmarkUpdates).not.toContainEqual({ ai_status: "failed" });
  });

  it("records the actual model used on success", async () => {
    const db = new FakeDb();
    const events: {
      model: string;
      provider: string;
      status: string;
      isByok: boolean | null;
    }[] = [];
    const provider = fakeProvider(
      vi.fn().mockResolvedValue({
        analysis: successResult,
        model: "google/gemini-3.1-flash-lite-20260507",
        isByok: true,
      }),
    );

    await categorizeBookmark({
      db,
      userId: "user",
      bookmarkId: "bookmark",
      provider,
      recordUsage: async (event) => {
        events.push({
          model: event.model,
          provider: event.provider,
          status: event.status,
          isByok: event.isByok,
        });
      },
      metadataFetcher: vi.fn().mockResolvedValue({
        title: null,
        description: null,
        siteName: null,
        faviconUrl: null,
        ogImageUrl: null,
      }),
    });

    expect(db.bookmark).toMatchObject({
      ai_status: "done",
      ai_model: "google/gemini-3.1-flash-lite-20260507",
      category_id: "cat-dev",
    });
    expect(events).toEqual([
      {
        model: "google/gemini-3.1-flash-lite-20260507",
        provider: "google",
        status: "success",
        isByok: true,
      },
    ]);
  });

  it("records a failed event with the preset model when the request throws", async () => {
    const db = new FakeDb();
    const events: {
      model: string;
      provider: string;
      status: string;
      isByok: boolean | null;
    }[] = [];
    const provider = fakeProvider(
      vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("rate limited"), { status: 429 }),
        ),
    );

    await categorizeBookmark({
      db,
      userId: "user",
      bookmarkId: "bookmark",
      provider,
      recordUsage: async (event) => {
        events.push({
          model: event.model,
          provider: event.provider,
          status: event.status,
          isByok: event.isByok,
        });
      },
      metadataFetcher: vi.fn().mockResolvedValue({
        title: null,
        description: null,
        siteName: null,
        faviconUrl: null,
        ogImageUrl: null,
      }),
    });

    expect(db.bookmark.ai_status).toBe("failed");
    expect(events).toEqual([
      {
        model: "@preset/my-bookmark",
        provider: "openrouter",
        status: "failed",
        isByok: null,
      },
    ]);
  });
});
