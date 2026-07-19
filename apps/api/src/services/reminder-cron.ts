import { API_ERROR_CODES, type ReminderRecurrence } from "@my-bookmark/shared";
import cron, { type ScheduledTask } from "node-cron";
import { appEnv } from "../lib/env";
import { supabaseAdmin } from "../lib/supabase";
import { HttpError } from "../middleware/error";
import type {
  OperationalMonitor,
  ReminderRunResult,
} from "./operational-monitor";
import {
  createDefaultPushSender,
  type StoredPushSubscription,
} from "./push-sender";
import { nextReminderAt } from "./reminder-recurrence";

interface DueReminderRow {
  id: string;
  user_id: string;
  bookmark_id: string;
  remind_at: string;
  note: string | null;
  recurrence: ReminderRecurrence;
  recurrence_timezone: string;
  recurrence_day: number | null;
  bookmark: {
    id: string;
    kind: "link" | "image";
    url: string | null;
    title: string | null;
  };
}

interface ReminderCronDb {
  dueReminders(now: Date, limit: number): Promise<DueReminderRow[]>;
  claimReminder(input: {
    id: string;
    expectedRemindAt: string;
    claimedAt: string;
    nextRemindAt: string | null;
  }): Promise<boolean>;
  subscriptionsForUser(userId: string): Promise<StoredPushSubscription[]>;
}

interface PushSenderLike {
  send(
    subscription: StoredPushSubscription,
    payload: { title: string; body: string; url: string },
  ): Promise<{ ok: boolean; expired?: boolean }>;
}

export interface ProcessDueRemindersOptions {
  db: ReminderCronDb;
  pushSender: PushSenderLike;
  now?: Date;
  limit?: number;
  webOrigin?: string;
}

export async function processDueReminders({
  db,
  pushSender,
  now = new Date(),
  limit = 20,
  webOrigin = appEnv.WEB_ORIGIN,
}: ProcessDueRemindersOptions): Promise<ReminderRunResult> {
  const reminders = await db.dueReminders(now, limit);
  let claimed = 0;
  let sent = 0;
  let failed = 0;
  let expired = 0;

  for (const reminder of reminders) {
    const nextRemindAt =
      reminder.recurrence === "none"
        ? null
        : nextReminderAt({
            scheduledAt: new Date(reminder.remind_at),
            recurrence: reminder.recurrence,
            timeZone: reminder.recurrence_timezone,
            now,
            recurrenceDay: reminder.recurrence_day,
          }).toISOString();
    const didClaim = await db.claimReminder({
      id: reminder.id,
      expectedRemindAt: reminder.remind_at,
      claimedAt: now.toISOString(),
      nextRemindAt,
    });
    if (!didClaim) {
      continue;
    }
    claimed += 1;

    const subscriptions = await db.subscriptionsForUser(reminder.user_id);
    const { fallback, targetUrl } = reminderTarget(
      reminder.bookmark,
      webOrigin,
    );
    for (const subscription of subscriptions) {
      const result = await pushSender.send(subscription, {
        title: `🔖 ${reminder.bookmark.title ?? fallback}`,
        body: reminder.note ?? fallback,
        url: targetUrl,
      });
      if (result.ok) {
        sent += 1;
      } else if (result.expired) {
        expired += 1;
      } else {
        failed += 1;
      }
    }
  }

  return { scanned: reminders.length, claimed, sent, failed, expired };
}

export function startReminderCron({
  pushConfigured,
  schedule = cron.schedule,
  monitor,
}: {
  pushConfigured: boolean;
  schedule?: typeof cron.schedule;
  monitor?: Pick<OperationalMonitor, "recordCronFailure" | "recordCronSuccess">;
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
  const task = schedule("* * * * *", async () => {
    try {
      const result = await processDueReminders({ db, pushSender });
      monitor?.recordCronSuccess(result);
    } catch (error) {
      monitor?.recordCronFailure(error);
      console.warn("reminder cron failed", error);
    }
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
          "id,user_id,bookmark_id,remind_at,note,recurrence,recurrence_timezone,recurrence_day,bookmarks!inner(id,kind,url,title)",
        )
        .eq("status", "pending")
        .eq("is_enabled", true)
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
          recurrence: row.recurrence,
          recurrence_timezone: row.recurrence_timezone,
          recurrence_day: row.recurrence_day,
          bookmark,
        };
      });
    },
    async claimReminder(input) {
      const updates =
        input.nextRemindAt === null
          ? { status: "sent", sent_at: input.claimedAt }
          : {
              status: "pending",
              sent_at: input.claimedAt,
              remind_at: input.nextRemindAt,
            };
      const { data, error } = await db
        .from("reminders")
        .update(updates)
        .eq("id", input.id)
        .eq("status", "pending")
        .eq("is_enabled", true)
        .eq("remind_at", input.expectedRemindAt)
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

function reminderTarget(
  bookmark: DueReminderRow["bookmark"],
  webOrigin: string,
): { fallback: string; targetUrl: string } {
  if (bookmark.kind === "image") {
    return {
      fallback: "이미지",
      targetUrl: `${webOrigin}/images/${bookmark.id}`,
    };
  }
  if (!bookmark.url) {
    throw new HttpError(
      500,
      API_ERROR_CODES.INTERNAL,
      "Link reminder bookmark is missing its URL",
    );
  }
  return { fallback: domainFromUrl(bookmark.url), targetUrl: bookmark.url };
}
