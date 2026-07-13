import {
  API_ERROR_CODES,
  createReminderRequestSchema,
  updateReminderRequestSchema,
  uuidSchema,
} from "@my-bookmark/shared";
import { type RequestHandler, Router } from "express";
import { mapReminderWithBookmark } from "../lib/db-mappers";
import { supabaseAdmin } from "../lib/supabase";
import { getUserId, requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";

interface ReminderDbRow {
  id: string;
  user_id: string;
  bookmark_id: string;
  remind_at: string;
  note: string | null;
  status: "pending" | "sent" | "cancelled";
  sent_at: string | null;
  created_at: string;
  bookmarks: {
    id: string;
    kind: "link" | "image";
    url: string | null;
    title: string | null;
  } | null;
}

interface RemindersDb {
  listPending(userId: string): Promise<ReminderDbRow[]>;
  bookmarkBelongsToUser(userId: string, bookmarkId: string): Promise<boolean>;
  createReminder(input: {
    userId: string;
    bookmarkId: string;
    remindAt: string;
    note: string | null;
  }): Promise<ReminderDbRow>;
  updatePendingReminder(input: {
    userId: string;
    id: string;
    remindAt?: string;
    note?: string | null;
  }): Promise<ReminderDbRow | null>;
  cancelPendingReminder(userId: string, id: string): Promise<void>;
}

export const remindersRouter = createRemindersRouter();

export function createRemindersRouter(
  getDb: () => RemindersDb = createSupabaseRemindersDb,
  auth: RequestHandler = requireAuth(),
): Router {
  const router = Router();

  router.use("/reminders", auth);

  router.get("/reminders", async (request, response) => {
    const userId = getUserId(request);
    const rows = await getDb().listPending(userId);
    response.json({ items: rows.map(mapReminderWithBookmark) });
  });

  router.post("/reminders", async (request, response) => {
    const userId = getUserId(request);
    const body = createReminderRequestSchema.parse(request.body);
    assertFutureRemindAt(body.remindAt);
    await assertBookmarkBelongsToUser(getDb(), userId, body.bookmarkId);
    const reminder = await getDb().createReminder({
      userId,
      bookmarkId: body.bookmarkId,
      remindAt: body.remindAt,
      note: body.note ?? null,
    });
    response.status(201).json({ reminder: mapReminderWithBookmark(reminder) });
  });

  router.patch("/reminders/:id", async (request, response) => {
    const userId = getUserId(request);
    const id = uuidSchema.parse(request.params.id);
    const body = updateReminderRequestSchema.parse(request.body);
    if (body.remindAt !== undefined) {
      assertFutureRemindAt(body.remindAt);
    }
    const reminder = await getDb().updatePendingReminder({
      userId,
      id,
      ...(body.remindAt === undefined ? {} : { remindAt: body.remindAt }),
      ...(body.note === undefined ? {} : { note: body.note }),
    });
    if (!reminder) {
      throw new HttpError(404, API_ERROR_CODES.NOT_FOUND, "Reminder not found");
    }
    response.json({ reminder: mapReminderWithBookmark(reminder) });
  });

  router.delete("/reminders/:id", async (request, response) => {
    const userId = getUserId(request);
    const id = uuidSchema.parse(request.params.id);
    await getDb().cancelPendingReminder(userId, id);
    response.status(204).send();
  });

  return router;
}

export function createSupabaseRemindersDb(): RemindersDb {
  if (!supabaseAdmin) {
    throw new HttpError(
      500,
      API_ERROR_CODES.INTERNAL,
      "Database is not configured",
    );
  }
  const db = supabaseAdmin;
  return {
    async listPending(userId) {
      const { data, error } = await db
        .from("reminders")
        .select("*,bookmarks(id,kind,url,title)")
        .eq("user_id", userId)
        .eq("status", "pending")
        .order("remind_at", { ascending: true });
      if (error) {
        throw error;
      }
      return data ?? [];
    },
    async bookmarkBelongsToUser(userId, bookmarkId) {
      const { data, error } = await db
        .from("bookmarks")
        .select("id")
        .eq("user_id", userId)
        .eq("id", bookmarkId)
        .maybeSingle();
      if (error) {
        throw error;
      }
      return Boolean(data);
    },
    async createReminder(input) {
      const { data, error } = await db
        .from("reminders")
        .insert({
          user_id: input.userId,
          bookmark_id: input.bookmarkId,
          remind_at: input.remindAt,
          note: input.note,
          status: "pending",
        })
        .select("*,bookmarks(id,kind,url,title)")
        .single();
      if (error) {
        throw error;
      }
      return data;
    },
    async updatePendingReminder(input) {
      const updates: { remind_at?: string; note?: string | null } = {};
      if (input.remindAt !== undefined) {
        updates.remind_at = input.remindAt;
      }
      if (input.note !== undefined) {
        updates.note = input.note;
      }
      const { data, error } = await db
        .from("reminders")
        .update(updates)
        .eq("user_id", input.userId)
        .eq("id", input.id)
        .eq("status", "pending")
        .select("*,bookmarks(id,kind,url,title)")
        .maybeSingle();
      if (error) {
        throw error;
      }
      return data;
    },
    async cancelPendingReminder(userId, id) {
      const { error } = await db
        .from("reminders")
        .update({ status: "cancelled" })
        .eq("user_id", userId)
        .eq("id", id)
        .eq("status", "pending");
      if (error) {
        throw error;
      }
    },
  };
}

async function assertBookmarkBelongsToUser(
  db: RemindersDb,
  userId: string,
  bookmarkId: string,
): Promise<void> {
  if (!(await db.bookmarkBelongsToUser(userId, bookmarkId))) {
    throw new HttpError(
      400,
      API_ERROR_CODES.VALIDATION_ERROR,
      "bookmarkId must reference one of your bookmarks",
    );
  }
}

function assertFutureRemindAt(remindAt: string): void {
  if (new Date(remindAt).getTime() <= Date.now()) {
    throw new HttpError(
      400,
      API_ERROR_CODES.VALIDATION_ERROR,
      "remindAt must be in the future",
    );
  }
}
