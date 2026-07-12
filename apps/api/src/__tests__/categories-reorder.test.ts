import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const userId = "11111111-1111-4111-8111-111111111111";
const catA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const catB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const createdAt = "2026-07-12T12:00:00.000Z";

const fake = vi.hoisted(() => ({
  rows: [] as { id: string; name: string; sort_order: number }[],
  sortOrderUpdates: [] as { id: string; sort_order: number }[],
}));

vi.mock("../lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table !== "categories") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: (columns: string) => ({
          eq: () => {
            const idRows = {
              data: fake.rows.map((r) => ({ id: r.id })),
              error: null,
            };
            if (columns === "id") {
              return Promise.resolve(idRows);
            }
            const fullRows = [...fake.rows]
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((r) => ({
                id: r.id,
                user_id: userId,
                name: r.name,
                sort_order: r.sort_order,
                created_at: createdAt,
              }));
            return {
              order: () => ({
                order: () => Promise.resolve({ data: fullRows, error: null }),
              }),
            };
          },
        }),
        update: (values: { sort_order: number }) => ({
          eq: () => ({
            eq: (_field: string, id: string) => {
              fake.sortOrderUpdates.push({ id, sort_order: values.sort_order });
              const row = fake.rows.find((r) => r.id === id);
              if (row) {
                row.sort_order = values.sort_order;
              }
              return Promise.resolve({ data: null, error: null });
            },
          }),
        }),
      };
    }),
  },
}));

vi.mock("../middleware/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middleware/auth")>();
  return {
    ...original,
    requireAuth:
      () =>
      (
        req: express.Request,
        _res: express.Response,
        next: express.NextFunction,
      ) => {
        req.userId = userId;
        next();
      },
  };
});

import { errorMiddleware } from "../middleware/error";
import { categoriesRouter } from "../routes/categories";

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", categoriesRouter);
  app.use(errorMiddleware);
  return app;
}

beforeEach(() => {
  fake.rows = [
    { id: catA, name: "💻 개발", sort_order: 0 },
    { id: catB, name: "📰 뉴스", sort_order: 1 },
  ];
  fake.sortOrderUpdates = [];
});

describe("PUT /api/categories/order", () => {
  it("assigns sort_order by array index and returns the reordered list", async () => {
    const response = await request(createTestApp())
      .put("/api/categories/order")
      .send({ ids: [catB, catA] });

    expect(response.status).toBe(200);
    expect(fake.sortOrderUpdates).toEqual([
      { id: catB, sort_order: 0 },
      { id: catA, sort_order: 1 },
    ]);
    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([
      catB,
      catA,
    ]);
  });

  it("rejects a list that does not include every category exactly once", async () => {
    const missing = await request(createTestApp())
      .put("/api/categories/order")
      .send({ ids: [catA] });
    expect(missing.status).toBe(400);

    const duplicated = await request(createTestApp())
      .put("/api/categories/order")
      .send({ ids: [catA, catA] });
    expect(duplicated.status).toBe(400);

    const unknown = await request(createTestApp())
      .put("/api/categories/order")
      .send({
        ids: [catA, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
      });
    expect(unknown.status).toBe(400);

    expect(fake.sortOrderUpdates).toEqual([]);
  });

  it("rejects sortOrder through PATCH now that reorder is a dedicated endpoint", async () => {
    const response = await request(createTestApp())
      .patch(`/api/categories/${catA}`)
      .send({ sortOrder: 3 });

    expect(response.status).toBe(400);
  });
});
