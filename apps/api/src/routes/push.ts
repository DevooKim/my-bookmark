import {
  API_ERROR_CODES,
  pushSubscriptionRequestSchema,
} from "@my-bookmark/shared";
import { Router } from "express";
import { appEnv } from "../lib/env";
import { supabaseAdmin } from "../lib/supabase";
import { getUserId, requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import {
  assertPushConfigured,
  createDefaultPushSender,
} from "../services/push-sender";

export const pushRouter = Router();

pushRouter.use("/push", requireAuth());

pushRouter.get("/push/status", async (request, response) => {
  const userId = getUserId(request);
  const { count, error } = await getDb()
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) {
    throw error;
  }
  response.json({
    enabled: (count ?? 0) > 0,
    subscriptionCount: count ?? 0,
    vapidPublicKey: appEnv.VAPID_PUBLIC_KEY ?? null,
  });
});

pushRouter.post("/push/subscriptions", async (request, response) => {
  const userId = getUserId(request);
  assertPushConfigured();
  const body = pushSubscriptionRequestSchema.parse(request.body);
  const { error } = await getDb()
    .from("push_subscriptions")
    .upsert(
      {
        user_id: userId,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        user_agent: request.header("user-agent") ?? null,
      },
      { onConflict: "endpoint" },
    );
  if (error) {
    throw error;
  }
  response.status(204).send();
});

pushRouter.post("/push/unsubscribe", async (request, response) => {
  const userId = getUserId(request);
  const body = pushSubscriptionRequestSchema
    .partial()
    .parse(request.body ?? {});
  let builder = getDb()
    .from("push_subscriptions")
    .delete()
    .eq("user_id", userId);
  if (body.endpoint) {
    builder = builder.eq("endpoint", body.endpoint);
  }
  const { error } = await builder;
  if (error) {
    throw error;
  }
  response.status(204).send();
});

pushRouter.post("/push/test", async (request, response) => {
  const userId = getUserId(request);
  assertPushConfigured();
  const { data, error } = await getDb()
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("user_id", userId);
  if (error) {
    throw error;
  }

  const sender = createDefaultPushSender();
  let sent = 0;
  let failed = 0;
  for (const row of data ?? []) {
    const result = await sender.send(
      {
        id: row.id,
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      },
      {
        title: "🔖 테스트 알림",
        body: "My Bookmark 푸시 알림이 정상 동작합니다.",
        url: appEnv.WEB_ORIGIN,
      },
    );
    if (result.ok) {
      sent += 1;
    } else {
      failed += 1;
    }
  }
  response.json({ sent, failed });
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
