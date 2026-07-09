import { API_ERROR_CODES } from "@my-bookmark/shared";
import webPush, { type PushSubscription } from "web-push";
import { appEnv } from "../lib/env";
import { supabaseAdmin } from "../lib/supabase";
import { HttpError } from "../middleware/error";

export interface StoredPushSubscription {
  id: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

export interface PushSendResult {
  ok: boolean;
  expired?: boolean;
}

interface CreatePushSenderDeps {
  sendNotification: (
    subscription: PushSubscription,
    payload: string,
  ) => Promise<unknown>;
  deleteSubscription: (id: string) => Promise<void>;
}

export function configureWebPush(): boolean {
  if (
    !appEnv.VAPID_PUBLIC_KEY ||
    !appEnv.VAPID_PRIVATE_KEY ||
    !appEnv.VAPID_SUBJECT
  ) {
    if (appEnv.NODE_ENV !== "test") {
      console.warn("VAPID keys are not configured; push sending is disabled");
    }
    return false;
  }

  webPush.setVapidDetails(
    appEnv.VAPID_SUBJECT,
    appEnv.VAPID_PUBLIC_KEY,
    appEnv.VAPID_PRIVATE_KEY,
  );
  return true;
}

export function assertPushConfigured(): void {
  if (
    !appEnv.VAPID_PUBLIC_KEY ||
    !appEnv.VAPID_PRIVATE_KEY ||
    !appEnv.VAPID_SUBJECT
  ) {
    throw new HttpError(
      500,
      API_ERROR_CODES.INTERNAL,
      "Push is not configured",
    );
  }
}

export function createPushSender(deps: CreatePushSenderDeps) {
  return {
    async send(
      subscription: StoredPushSubscription,
      payload: PushPayload,
    ): Promise<PushSendResult> {
      try {
        await deps.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: subscription.keys,
          },
          JSON.stringify(payload),
        );
        return { ok: true };
      } catch (error) {
        if (isExpiredPushError(error)) {
          await deps.deleteSubscription(subscription.id);
          return { ok: false, expired: true };
        }
        console.warn("push send failed", error);
        return { ok: false };
      }
    },
  };
}

export function createDefaultPushSender() {
  return createPushSender({
    sendNotification: (subscription, payload) =>
      webPush.sendNotification(subscription, payload),
    deleteSubscription: deleteSubscriptionById,
  });
}

async function deleteSubscriptionById(id: string): Promise<void> {
  if (!supabaseAdmin) {
    throw new HttpError(
      500,
      API_ERROR_CODES.INTERNAL,
      "Database is not configured",
    );
  }
  const { error } = await supabaseAdmin
    .from("push_subscriptions")
    .delete()
    .eq("id", id);
  if (error) {
    throw error;
  }
}

function isExpiredPushError(error: unknown): boolean {
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return statusCode === 404 || statusCode === 410;
}
