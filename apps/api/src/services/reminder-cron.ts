import { API_ERROR_CODES } from "@my-bookmark/shared";
import cron, { type ScheduledTask } from "node-cron";
import { appEnv } from "../lib/env";
import { supabaseAdmin } from "../lib/supabase";
import { HttpError } from "../middleware/error";
import {
  createDefaultPushSender,
  type StoredPushSubscription,
} from "./push-sender";

interface DueReminderRow {
  id: string;
  user_id: string;
  bookmark_id: string;
  remind_at: string;
  note: string | null;
  bookmark: {
    url: string;
    title: string | null;
  };
}

interface ReminderCronDb {
  dueReminders(now: Date, limit: number): Promise<DueReminderRow[]>;
  claimReminder(id: string): Promise<boolean>;
  subscriptionsForUser(userId: string): Promise<StoredPushSubscription[]>;
}

interface PushSenderLike {
  send(
    subscription: StoredPushSubscription,
    payload: { title: string; body: string; url: string },
  ): Promise<{ ok: boolean }>;
}

export interface ProcessDueRemindersOptions {
  db: ReminderCronDb;
  pushSender: PushSenderLike;
  now?: Date;
  limit?: number;
}

export async function processDueReminders({
  db,
  pushSender,
  now = new Date(),
  limit = 20,
}: ProcessDueRemindersOptions): Promise<{
  scanned: number;
  claimed: number;
  sent: number;
  failed: number;
}> {
  const reminders = await db.dueReminders(now, limit);
  let claimed = 0;
  let sent = 0;
  let failed = 0;

  for (const reminder of reminders) {
    const didClaim = await db.claimReminder(reminder.id);
    if (!didClaim) {
      continue;
    }
    claimed += 1;

    const subscriptions = await db.subscriptionsForUser(reminder.user_id);
    for (const subscription of subscriptions) {
      const result = await pushSender.send(subscription, {
        title: `🔖 ${reminder.bookmark.title ?? domainFromUrl(reminder.bookmark.url)}`,
        body: reminder.note ?? domainFromUrl(reminder.bookmark.url),
        url: reminder.bookmark.url,
      });
      if (result.ok) {
        sent += 1;
      } else {
        failed += 1;
      }
    }
  }

  return { scanned: reminders.length, claimed, sent, failed };
}

export function startReminderCron({
  pushConfigured,
  schedule = cron.schedule,
}: {
  pushConfigured: boolean;
  schedule?: typeof cron.schedule;
}): ScheduledTask | null {
  if (!pushConfigured) {
    if (appEnv.NODE_ENV !== "test") {
      console.warn("Reminder cron is disabled because push is not configured");
    }
    return null;
  }
  if (appEnv.NODE_ENV === "test") {
    return null;
  }
  const db = createSupabaseReminderCronDb();
  const pushSender = createDefaultPushSender();
  const task = schedule("* * * * *", () => {
    void processDueReminders({ db, pushSender }).catch((error) => {
      console.warn("reminder cron failed", error);
    });
  });
  task.start();
  return task;
}

export function createSupabaseReminderCronDb(): ReminderCronDb {
  if (!supabaseAdmin) {
    throw new HttpError(
      500,
      API_ERROR_CODES.INTERNAL,
      "Database is not configured",
    );
  }
  const db = supabaseAdmin;

  return {
    async dueReminders(now, limit) {
      const { data, error } = await db
        .from("reminders")
        .select(
          "id,user_id,bookmark_id,remind_at,note,bookmarks!inner(url,title)",
        )
        .eq("status", "pending")
        .lte("remind_at", now.toISOString())
        .order("remind_at", { ascending: true })
        .limit(limit);
      if (error) {
        throw error;
      }
      return (data ?? []).map((row) => {
        const bookmark = Array.isArray(row.bookmarks)
          ? row.bookmarks[0]
          : row.bookmarks;
        if (!bookmark) {
          throw new HttpError(
            500,
            API_ERROR_CODES.INTERNAL,
            "Reminder bookmark is missing",
          );
        }
        return {
          id: row.id,
          user_id: row.user_id,
          bookmark_id: row.bookmark_id,
          remind_at: row.remind_at,
          note: row.note,
          bookmark,
        };
      });
    },
    async claimReminder(id) {
      const { data, error } = await db
        .from("reminders")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (error) {
        throw error;
      }
      return Boolean(data);
    },
    async subscriptionsForUser(userId) {
      const { data, error } = await db
        .from("push_subscriptions")
        .select("id,endpoint,p256dh,auth")
        .eq("user_id", userId);
      if (error) {
        throw error;
      }
      return (data ?? []).map((row) => ({
        id: row.id,
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      }));
    },
  };
}

function domainFromUrl(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}
