import type { AiProvider } from "@my-bookmark/ai";
import { describe, expect, it, vi } from "vitest";
import {
  applyCategorizeResult,
  categorizeBookmark,
} from "../services/categorize";

type AnalyzeResult = Awaited<ReturnType<AiProvider["categorize"]>>;

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
  tags: ["웹 접근성", "프론트엔드", "사용자 경험"],
});

describe("applyCategorizeResult", () => {
  it("applies category, summary title, and tags in one pending-guarded update", async () => {
    const db = new FakeDb();
    await applyCategorizeResult(
      db,
      "user",
      "bookmark",
      db.categories,
      analysis({ type: "none" }),
    );

    expect(db.bookmarkUpdates).toEqual([
      {
        category_id: null,
        title: "웹 접근성 실전 안내",
        tags: ["웹 접근성", "프론트엔드", "사용자 경험"],
        ai_status: "done",
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
    );

    expect(db.categories).toHaveLength(1);
    expect(db.bookmark.category_id).toBe("cat-news");
  });
});

describe("categorizeBookmark", () => {
  it("preserves prior title, tags, and category when the provider fails", async () => {
    const db = new FakeDb();
    db.bookmark.category_id = "cat-dev";
    const provider: AiProvider = {
      name: "failing",
      categorize: vi.fn().mockRejectedValue(new Error("provider failed")),
      validateConnection: vi.fn(),
    };

    await categorizeBookmark({
      db,
      userId: "user",
      bookmarkId: "bookmark",
      provider,
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
});
