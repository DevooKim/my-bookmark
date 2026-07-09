import {
  API_ERROR_CODES,
  createReminderRequestSchema,
  updateReminderRequestSchema,
  uuidSchema,
} from "@my-bookmark/shared";
import { Router } from "express";
import { mapReminderWithBookmark } from "../lib/db-mappers";
import { supabaseAdmin } from "../lib/supabase";
import { getUserId, requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";

export const remindersRouter = Router();

remindersRouter.use("/reminders", requireAuth());

remindersRouter.get("/reminders", async (request, response) => {
  const userId = getUserId(request);
  const { data, error } = await getDb()
    .from("reminders")
    .select("*,bookmarks(id,url,title)")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("remind_at", { ascending: true });
  if (error) {
    throw error;
  }
  response.json({ items: (data ?? []).map(mapReminderWithBookmark) });
});

remindersRouter.post("/reminders", async (request, response) => {
  const userId = getUserId(request);
  const body = createReminderRequestSchema.parse(request.body);
  await assertBookmarkBelongsToUser(userId, body.bookmarkId);
  const { data, error } = await getDb()
    .from("reminders")
    .insert({
      user_id: userId,
      bookmark_id: body.bookmarkId,
      remind_at: body.remindAt,
      note: body.note ?? null,
      status: "pending",
    })
    .select("*,bookmarks(id,url,title)")
    .single();
  if (error) {
    throw error;
  }
  response.status(201).json({ reminder: mapReminderWithBookmark(data) });
});

remindersRouter.patch("/reminders/:id", async (request, response) => {
  const userId = getUserId(request);
  const id = uuidSchema.parse(request.params.id);
  const body = updateReminderRequestSchema.parse(request.body);
  const { data, error } = await getDb()
    .from("reminders")
    .update({ status: body.status })
    .eq("user_id", userId)
    .eq("id", id)
    .eq("status", "pending")
    .select("*,bookmarks(id,url,title)")
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    throw new HttpError(404, API_ERROR_CODES.NOT_FOUND, "Reminder not found");
  }
  response.json({ reminder: mapReminderWithBookmark(data) });
});

remindersRouter.delete("/reminders/:id", async (request, response) => {
  const userId = getUserId(request);
  const id = uuidSchema.parse(request.params.id);
  const { error } = await getDb()
    .from("reminders")
    .update({ status: "cancelled" })
    .eq("user_id", userId)
    .eq("id", id)
    .eq("status", "pending");
  if (error) {
    throw error;
  }
  response.status(204).send();
});

async function assertBookmarkBelongsToUser(
  userId: string,
  bookmarkId: string,
): Promise<void> {
  const { data, error } = await getDb()
    .from("bookmarks")
    .select("id")
    .eq("user_id", userId)
    .eq("id", bookmarkId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    throw new HttpError(
      400,
      API_ERROR_CODES.VALIDATION_ERROR,
      "bookmarkId must reference one of your bookmarks",
    );
  }
}

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
