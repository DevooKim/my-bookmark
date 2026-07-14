import {
  API_ERROR_CODES,
  createReminderRequestSchema,
  type ReminderRecurrence,
  rescheduleReminderRequestSchema,
  updateReminderRequestSchema,
  uuidSchema,
} from "@my-bookmark/shared";
import { type RequestHandler, Router } from "express";
import { mapReminderWithBookmark } from "../lib/db-mappers";
import { supabaseAdmin } from "../lib/supabase";
import { getUserId, requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import {
  assertReminderTimezone,
  localDayInTimezone,
  nextReminderAt,
} from "../services/reminder-recurrence";

interface ReminderDbRow {
  id: string;
  user_id: string;
  bookmark_id: string;
  remind_at: string;
  note: string | null;
  status: "pending" | "sent" | "cancelled";
  sent_at: string | null;
  recurrence: ReminderRecurrence;
  recurrence_timezone: string;
  recurrence_day: number | null;
  is_enabled: boolean;
  created_at: string;
  bookmarks: {
    id: string;
    kind: "link" | "image";
    url: string | null;
    title: string | null;
  } | null;
}

interface RemindersDb {
  listVisible(userId: string): Promise<ReminderDbRow[]>;
  getReminder(userId: string, id: string): Promise<ReminderDbRow | null>;
  bookmarkBelongsToUser(userId: string, bookmarkId: string): Promise<boolean>;
  createReminder(input: {
    userId: string;
    bookmarkId: string;
    remindAt: string;
    note: string | null;
    recurrence: ReminderRecurrence;
    recurrenceTimezone: string;
    recurrenceDay: number | null;
  }): Promise<ReminderDbRow>;
  updatePendingReminder(input: {
    userId: string;
    id: string;
    remindAt: string;
    note: string | null;
    recurrence: ReminderRecurrence;
    recurrenceTimezone: string;
    recurrenceDay: number | null;
    isEnabled: boolean;
  }): Promise<ReminderDbRow | null>;
  rescheduleReminder(input: {
    userId: string;
    id: string;
    remindAt: string;
    note: string | null;
    recurrence: ReminderRecurrence;
    recurrenceTimezone: string;
    recurrenceDay: number | null;
  }): Promise<ReminderDbRow | null>;
  cancelReminder(userId: string, id: string): Promise<void>;
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
    const rows = await getDb().listVisible(userId);
    response.json({ items: rows.map(mapReminderWithBookmark) });
  });

  router.post("/reminders", async (request, response) => {
    const userId = getUserId(request);
    const body = createReminderRequestSchema.parse(request.body);
    assertFutureRemindAt(body.remindAt);
    assertValidTimezone(body.recurrenceTimezone);
    await assertBookmarkBelongsToUser(getDb(), userId, body.bookmarkId);
    const reminder = await getDb().createReminder({
      userId,
      bookmarkId: body.bookmarkId,
      remindAt: body.remindAt,
      note: body.note ?? null,
      recurrence: body.recurrence,
      recurrenceTimezone: body.recurrenceTimezone,
      recurrenceDay: recurrenceDay(
        body.remindAt,
        body.recurrence,
        body.recurrenceTimezone,
      ),
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
    const db = getDb();
    const current = await db.getReminder(userId, id);
    if (current?.status !== "pending") {
      throw new HttpError(404, API_ERROR_CODES.NOT_FOUND, "Reminder not found");
    }
    const recurrence = body.recurrence ?? current.recurrence;
    const recurrenceTimezone =
      body.recurrenceTimezone ?? current.recurrence_timezone;
    assertValidTimezone(recurrenceTimezone);
    if (body.isEnabled === false && recurrence === "none") {
      throw new HttpError(
        400,
        API_ERROR_CODES.VALIDATION_ERROR,
        "Only recurring reminders can be disabled",
      );
    }
    let remindAt = body.remindAt ?? current.remind_at;
    const isEnabled = body.isEnabled ?? current.is_enabled;
    if (
      body.isEnabled === true &&
      !current.is_enabled &&
      recurrence !== "none" &&
      new Date(remindAt).getTime() <= Date.now()
    ) {
      remindAt = nextReminderAt({
        scheduledAt: new Date(remindAt),
        recurrence,
        timeZone: recurrenceTimezone,
        now: new Date(),
        recurrenceDay: current.recurrence_day,
      }).toISOString();
    }
    const scheduleChanged =
      body.remindAt !== undefined ||
      body.recurrence !== undefined ||
      body.recurrenceTimezone !== undefined;
    const reminder = await getDb().updatePendingReminder({
      userId,
      id,
      remindAt,
      note: body.note === undefined ? current.note : body.note,
      recurrence,
      recurrenceTimezone,
      recurrenceDay:
        recurrence === "monthly"
          ? scheduleChanged
            ? localDayInTimezone(new Date(remindAt), recurrenceTimezone)
            : (current.recurrence_day ??
              localDayInTimezone(new Date(remindAt), recurrenceTimezone))
          : null,
      isEnabled,
    });
    if (!reminder) {
      throw new HttpError(404, API_ERROR_CODES.NOT_FOUND, "Reminder not found");
    }
    response.json({ reminder: mapReminderWithBookmark(reminder) });
  });

  router.post("/reminders/:id/reschedule", async (request, response) => {
    const userId = getUserId(request);
    const id = uuidSchema.parse(request.params.id);
    const body = rescheduleReminderRequestSchema.parse(request.body);
    assertFutureRemindAt(body.remindAt);
    assertValidTimezone(body.recurrenceTimezone);
    const reminder = await getDb().rescheduleReminder({
      userId,
      id,
      remindAt: body.remindAt,
      note: body.note ?? null,
      recurrence: body.recurrence,
      recurrenceTimezone: body.recurrenceTimezone,
      recurrenceDay: recurrenceDay(
        body.remindAt,
        body.recurrence,
        body.recurrenceTimezone,
      ),
    });
    if (!reminder) {
      throw new HttpError(404, API_ERROR_CODES.NOT_FOUND, "Reminder not found");
    }
    response.json({ reminder: mapReminderWithBookmark(reminder) });
  });

  router.delete("/reminders/:id", async (request, response) => {
    const userId = getUserId(request);
    const id = uuidSchema.parse(request.params.id);
    await getDb().cancelReminder(userId, id);
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
    async listVisible(userId) {
      const { data, error } = await db
        .from("reminders")
        .select("*,bookmarks(id,kind,url,title)")
        .eq("user_id", userId)
        .neq("status", "cancelled")
        .order("remind_at", { ascending: true });
      if (error) {
        throw error;
      }
      return data ?? [];
    },
    async getReminder(userId, id) {
      const { data, error } = await db
        .from("reminders")
        .select("*,bookmarks(id,kind,url,title)")
        .eq("user_id", userId)
        .eq("id", id)
        .neq("status", "cancelled")
        .maybeSingle();
      if (error) {
        throw error;
      }
      return data;
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
          recurrence: input.recurrence,
          recurrence_timezone: input.recurrenceTimezone,
          recurrence_day: input.recurrenceDay,
          is_enabled: true,
        })
        .select("*,bookmarks(id,kind,url,title)")
        .single();
      if (error) {
        throw error;
      }
      return data;
    },
    async updatePendingReminder(input) {
      const { data, error } = await db
        .from("reminders")
        .update({
          remind_at: input.remindAt,
          note: input.note,
          recurrence: input.recurrence,
          recurrence_timezone: input.recurrenceTimezone,
          recurrence_day: input.recurrenceDay,
          is_enabled: input.isEnabled,
        })
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
    async rescheduleReminder(input) {
      const { data, error } = await db
        .from("reminders")
        .update({
          remind_at: input.remindAt,
          note: input.note,
          status: "pending",
          sent_at: null,
          recurrence: input.recurrence,
          recurrence_timezone: input.recurrenceTimezone,
          recurrence_day: input.recurrenceDay,
          is_enabled: true,
        })
        .eq("user_id", input.userId)
        .eq("id", input.id)
        .eq("status", "sent")
        .select("*,bookmarks(id,kind,url,title)")
        .maybeSingle();
      if (error) {
        throw error;
      }
      return data;
    },
    async cancelReminder(userId, id) {
      const { error } = await db
        .from("reminders")
        .update({ status: "cancelled" })
        .eq("user_id", userId)
        .eq("id", id)
        .neq("status", "cancelled");
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

function assertValidTimezone(timeZone: string): void {
  try {
    assertReminderTimezone(timeZone);
  } catch {
    throw new HttpError(
      400,
      API_ERROR_CODES.VALIDATION_ERROR,
      "recurrenceTimezone must be a valid IANA timezone",
    );
  }
}

function recurrenceDay(
  remindAt: string,
  recurrence: ReminderRecurrence,
  timeZone: string,
): number | null {
  return recurrence === "monthly"
    ? localDayInTimezone(new Date(remindAt), timeZone)
    : null;
}
