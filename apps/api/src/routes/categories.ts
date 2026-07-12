import {
  API_ERROR_CODES,
  createCategoryRequestSchema,
  reorderCategoriesRequestSchema,
  updateCategoryRequestSchema,
  uuidSchema,
} from "@my-bookmark/shared";
import { Router } from "express";
import { mapCategory, mapCategoryWithCount } from "../lib/db-mappers";
import { supabaseAdmin } from "../lib/supabase";
import { getUserId, requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";

interface CategoryUpdate {
  name?: string;
}

export const categoriesRouter = Router();

categoriesRouter.use("/categories", requireAuth({ apiKey: true }));

categoriesRouter.get("/categories", async (request, response) => {
  const userId = getUserId(request);
  // Express query is typed as an index signature; dot access fails noPropertyAccessFromIndexSignature.
  // biome-ignore lint/complexity/useLiteralKeys: bracket access is required by TypeScript config.
  const withCounts = request.query["withCounts"] === "true";
  const db = getDb();
  const { data, error } = await db
    .from("categories")
    .select("*")
    .eq("user_id", userId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    throw error;
  }

  if (!withCounts) {
    response.json({ items: (data ?? []).map(mapCategory) });
    return;
  }

  const counts = await loadBookmarkCounts(userId);
  response.json({
    items: (data ?? []).map((row) =>
      mapCategoryWithCount({ ...row, bookmark_count: counts.get(row.id) ?? 0 }),
    ),
  });
});

categoriesRouter.post("/categories", async (request, response) => {
  const userId = getUserId(request);
  const body = createCategoryRequestSchema.parse(request.body);
  const { data, error } = await getDb()
    .from("categories")
    .insert({
      user_id: userId,
      name: body.name,
    })
    .select("*")
    .single();

  if (error) {
    handleCategoryWriteError(error);
  }

  response.status(201).json({ category: mapCategory(data) });
});

categoriesRouter.patch("/categories/:id", async (request, response) => {
  const userId = getUserId(request);
  const id = uuidSchema.parse(request.params.id);
  const body = updateCategoryRequestSchema.parse(request.body);
  const updates: CategoryUpdate = {};
  if (body.name !== undefined) {
    updates.name = body.name;
  }

  const { data, error } = await getDb()
    .from("categories")
    .update(updates)
    .eq("user_id", userId)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    handleCategoryWriteError(error);
  }
  if (!data) {
    throw new HttpError(404, API_ERROR_CODES.NOT_FOUND, "Category not found");
  }

  response.json({ category: mapCategory(data) });
});

categoriesRouter.put("/categories/order", async (request, response) => {
  const userId = getUserId(request);
  const body = reorderCategoriesRequestSchema.parse(request.body);
  const db = getDb();

  const { data: existing, error: loadError } = await db
    .from("categories")
    .select("id")
    .eq("user_id", userId);
  if (loadError) {
    throw loadError;
  }
  const existingIds = new Set((existing ?? []).map((row) => row.id));
  const uniqueRequested = new Set(body.ids);
  const isExactPermutation =
    uniqueRequested.size === body.ids.length &&
    existingIds.size === body.ids.length &&
    body.ids.every((id) => existingIds.has(id));
  if (!isExactPermutation) {
    throw new HttpError(
      400,
      API_ERROR_CODES.VALIDATION_ERROR,
      "ids must include every category exactly once",
    );
  }

  for (const [index, id] of body.ids.entries()) {
    const { error } = await db
      .from("categories")
      .update({ sort_order: index })
      .eq("user_id", userId)
      .eq("id", id);
    if (error) {
      throw error;
    }
  }

  const { data, error } = await db
    .from("categories")
    .select("*")
    .eq("user_id", userId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    throw error;
  }
  response.json({ items: (data ?? []).map(mapCategory) });
});

categoriesRouter.delete("/categories/:id", async (request, response) => {
  const userId = getUserId(request);
  const id = uuidSchema.parse(request.params.id);
  const { error } = await getDb()
    .from("categories")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);
  if (error) {
    throw error;
  }
  response.status(204).send();
});

function getDb() {
  if (!supabaseAdmin) {
    throw new HttpError(
      500,
      API_ERROR_CODES.INTERNAL,
      "Database is not configured",
    );
  }
  return supabaseAdmin;
}

async function loadBookmarkCounts(
  userId: string,
): Promise<Map<string, number>> {
  const { data, error } = await getDb()
    .from("bookmarks")
    .select("category_id")
    .eq("user_id", userId)
    .not("category_id", "is", null);
  if (error) {
    throw error;
  }

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    if (row.category_id) {
      counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
    }
  }
  return counts;
}

function handleCategoryWriteError(error: { code?: string }): never {
  if (error.code === "23505") {
    throw new HttpError(
      409,
      API_ERROR_CODES.CONFLICT,
      "이미 있는 카테고리예요",
    );
  }
  throw error;
}
