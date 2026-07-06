import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { requireAuth } from "../middleware/auth";
import { errorMiddleware } from "../middleware/error";
import { createKeysRouter } from "../routes/keys";

const userId = "11111111-1111-4111-8111-111111111111";

interface ApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

class FakeApiKeysDb {
  rows: ApiKeyRow[] = [];
  private insertValue: Partial<ApiKeyRow> | null = null;
  private updateValue: Partial<ApiKeyRow> | null = null;
  private filters: Array<[string, string]> = [];

  from(table: string) {
    expect(table).toBe("api_keys");
    this.insertValue = null;
    this.updateValue = null;
    this.filters = [];
    return this;
  }

  insert(value: Partial<ApiKeyRow>) {
    this.insertValue = value;
    return this;
  }

  update(value: Partial<ApiKeyRow>) {
    this.updateValue = value;
    return this;
  }

  select() {
    return this;
  }

  eq(field: string, value: string) {
    this.filters.push([field, value]);
    if (this.updateValue && this.filters.length >= 2) {
      return this.applyUpdate();
    }
    return this;
  }

  is(field: string, value: null) {
    this.filters.push([field, String(value)]);
    return this;
  }

  order() {
    return Promise.resolve({ data: this.filteredRows(), error: null });
  }

  single() {
    if (!this.insertValue) {
      throw new Error("single() used without insert");
    }
    const row: ApiKeyRow = {
      id: "22222222-2222-4222-8222-222222222222",
      user_id: String(this.insertValue.user_id),
      name: String(this.insertValue.name),
      key_hash: String(this.insertValue.key_hash),
      key_prefix: String(this.insertValue.key_prefix),
      last_used_at: null,
      revoked_at: null,
      created_at: "2026-07-07T00:00:00.000Z",
    };
    this.rows.push(row);
    return Promise.resolve({ data: row, error: null });
  }

  private applyUpdate() {
    for (const row of this.filteredRows()) {
      Object.assign(row, this.updateValue);
    }
    return Promise.resolve({ error: null });
  }

  private filteredRows() {
    return this.rows.filter((row) =>
      this.filters.every(([field, value]) => {
        if (field === "revoked_at") {
          return row.revoked_at === null && value === "null";
        }
        return String(row[field as keyof ApiKeyRow]) === value;
      }),
    );
  }
}

function createTestApp(db: FakeApiKeysDb) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createKeysRouter(() => db, requireAuth({ bearer: async () => userId })),
  );
  app.use(errorMiddleware);
  return app;
}

describe("keys routes", () => {
  it("creates an API key and only exposes the raw key once", async () => {
    const db = new FakeApiKeysDb();
    const app = createTestApp(db);

    const createResponse = await request(app)
      .post("/api/keys")
      .set("Authorization", "Bearer token")
      .send({ name: "iOS shortcut" });
    const listResponse = await request(app)
      .get("/api/keys")
      .set("Authorization", "Bearer token");

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.key).toMatch(/^bm_[A-Za-z0-9_-]{43}$/);
    expect(createResponse.body.keyPrefix).toBe(
      createResponse.body.key.slice(0, 10),
    );
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.items).toEqual([
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "iOS shortcut",
        keyPrefix: createResponse.body.keyPrefix,
        lastUsedAt: null,
        createdAt: "2026-07-07T00:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(listResponse.body)).not.toContain(
      createResponse.body.key,
    );
  });

  it("revokes an API key without deleting the audit row", async () => {
    const db = new FakeApiKeysDb();
    const app = createTestApp(db);
    await request(app)
      .post("/api/keys")
      .set("Authorization", "Bearer token")
      .send({ name: "iOS shortcut" });

    const response = await request(app)
      .delete("/api/keys/22222222-2222-4222-8222-222222222222")
      .set("Authorization", "Bearer token");

    expect(response.status).toBe(204);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]?.revoked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
