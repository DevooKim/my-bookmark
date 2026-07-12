import type { AiProvider, AnalyzeResult } from "@my-bookmark/ai";
import { describe, expect, it, vi } from "vitest";
import {
  applyCategorizeResult,
  categorizeBookmark,
} from "../services/categorize";

class FakeDb {
  categories = [{ id: "cat-dev", name: "개발" }];
  bookmark = {
    id: "bookmark",
    user_id: "user",
    url: "https://example.com/article",
    title: "기존 메타데이터 제목" as string | null,
    description: null as string | null,
    site_name: null as string | null,
    category_id: null as string | null,
    tags: ["기존 태그"],
    ai_status: "pending" as "idle" | "pending" | "done" | "failed",
    ai_model: null as string | null,
  };
  bookmarkUpdates: Record<string, unknown>[] = [];

  from(table: string) {
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
          return {
            eq: () => ({
              eq: () => ({
                eq: (_field: string, value: string) => {
                  if (value === this.bookmark.ai_status) {
                    Object.assign(this.bookmark, values);
                  }
                  return Promise.resolve({ data: null, error: null });
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

  it("records the actual model used on success", async () => {
    const db = new FakeDb();
    const events: { model: string; provider: string; status: string }[] = [];
    const provider = fakeProvider(
      vi.fn().mockResolvedValue({
        analysis: successResult,
        model: "google/gemini-3.1-flash-lite-20260507",
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
      },
    ]);
  });

  it("records a failed event with the preset model when the request throws", async () => {
    const db = new FakeDb();
    const events: { model: string; provider: string; status: string }[] = [];
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
      },
    ]);
  });
});
