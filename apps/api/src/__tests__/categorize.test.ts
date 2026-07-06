import type { CategorizeResult } from "@my-bookmark/ai";
import { describe, expect, it } from "vitest";
import { applyCategorizeResult } from "../services/categorize";

class FakeDb {
  categories = [{ id: "cat-dev", name: "개발" }];
  bookmark = { category_id: null as string | null, ai_status: "pending" };

  from(table: string) {
    if (table === "bookmarks") {
      return {
        update: (values: Record<string, unknown>) => ({
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
        }),
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

describe("applyCategorizeResult", () => {
  it("sets an existing category only when the bookmark is still pending", async () => {
    const db = new FakeDb();
    await applyCategorizeResult(db, "user", "bookmark", db.categories, {
      type: "existing",
      categoryId: "cat-dev",
      confidence: 0.9,
    });

    expect(db.bookmark).toMatchObject({
      category_id: "cat-dev",
      ai_status: "done",
    });

    db.bookmark = { category_id: "manual", ai_status: "idle" };
    await applyCategorizeResult(db, "user", "bookmark", db.categories, {
      type: "existing",
      categoryId: "cat-dev",
      confidence: 0.9,
    });
    expect(db.bookmark).toEqual({ category_id: "manual", ai_status: "idle" });
  });

  it("reuses a same-name category before creating a new category", async () => {
    const db = new FakeDb();
    await applyCategorizeResult(db, "user", "bookmark", db.categories, {
      type: "new",
      name: " 개발 ",
      confidence: 0.8,
    });

    expect(db.categories).toHaveLength(1);
    expect(db.bookmark.category_id).toBe("cat-dev");
  });

  it("creates new categories and leaves none results uncategorized", async () => {
    const db = new FakeDb();
    const result: CategorizeResult = {
      type: "new",
      name: "디자인",
      confidence: 0.8,
    };
    await applyCategorizeResult(db, "user", "bookmark", db.categories, result);
    expect(db.categories.at(-1)).toEqual({ id: "cat-2", name: "디자인" });
    expect(db.bookmark.category_id).toBe("cat-2");

    db.bookmark = { category_id: "cat-2", ai_status: "pending" };
    await applyCategorizeResult(db, "user", "bookmark", db.categories, {
      type: "none",
    });
    expect(db.bookmark).toMatchObject({ category_id: null, ai_status: "done" });
  });
});
