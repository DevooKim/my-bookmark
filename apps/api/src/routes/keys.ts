import { randomBytes } from "node:crypto";
import {
  API_ERROR_CODES,
  createApiKeyRequestSchema,
  uuidSchema,
} from "@my-bookmark/shared";
import { type RequestHandler, Router } from "express";
import { supabaseAdmin } from "../lib/supabase";
import { getUserId, hashApiKey, requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";

interface ApiKeyDbRow {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  created_at: string;
}

interface ApiKeysDb {
  from(table: "api_keys"): {
    insert(values: {
      user_id: string;
      name: string;
      key_hash: string;
      key_prefix: string;
    }): {
      select(columns: string): {
        single(): PromiseLike<{ data: ApiKeyDbRow | null; error: unknown }>;
      };
    };
    select(columns: string): {
      eq(
        field: string,
        value: string,
      ): {
        is(
          field: string,
          value: null,
        ): {
          order(
            field: string,
            options: { ascending: boolean },
          ): PromiseLike<{ data: ApiKeyDbRow[] | null; error: unknown }>;
        };
      };
    };
    update(values: { revoked_at: string }): {
      eq(
        field: string,
        value: string,
      ): {
        eq(
          field: string,
          value: string,
        ): PromiseLike<{ data?: unknown; error: unknown }>;
      };
    };
  };
}

type DbGetter = () => unknown;

export const keysRouter = createKeysRouter();

export function createKeysRouter(
  getDb: DbGetter = getDefaultDb,
  auth: RequestHandler = requireAuth(),
): Router {
  const router = Router();
  router.use("/keys", auth);

  router.post("/keys", async (request, response) => {
    const userId = getUserId(request);
    const body = createApiKeyRequestSchema.parse(request.body);
    const key = generateApiKey();
    const keyPrefix = key.slice(0, 10);
    const db = getDb() as ApiKeysDb;
    const { data, error } = await db
      .from("api_keys")
      .insert({
        user_id: userId,
        name: body.name,
        key_hash: hashApiKey(key),
        key_prefix: keyPrefix,
      })
      .select("id,name,key_prefix,last_used_at,created_at")
      .single();
    if (error) {
      throw error;
    }
    if (!data) {
      throw new HttpError(
        500,
        API_ERROR_CODES.INTERNAL,
        "API key was not created",
      );
    }

    response.status(201).json({ ...mapApiKey(data), key });
  });

  router.get("/keys", async (request, response) => {
    const userId = getUserId(request);
    const db = getDb() as ApiKeysDb;
    const { data, error } = await db
      .from("api_keys")
      .select("id,name,key_prefix,last_used_at,created_at")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    if (error) {
      throw error;
    }
    response.json({ items: (data ?? []).map(mapApiKey) });
  });

  router.delete("/keys/:id", async (request, response) => {
    const userId = getUserId(request);
    const id = uuidSchema.parse(request.params.id);
    const db = getDb() as ApiKeysDb;
    const { error } = await db
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("id", id);
    if (error) {
      throw error;
    }
    response.status(204).send();
  });

  return router;
}

function getDefaultDb(): unknown {
  if (!supabaseAdmin) {
    throw new HttpError(
      500,
      API_ERROR_CODES.INTERNAL,
      "Database is not configured",
    );
  }
  return supabaseAdmin;
}

function generateApiKey(): string {
  return `bm_${randomBytes(32).toString("base64url")}`;
}

function mapApiKey(row: ApiKeyDbRow) {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}
