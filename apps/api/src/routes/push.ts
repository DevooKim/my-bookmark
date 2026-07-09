import {
  API_ERROR_CODES,
  pushSubscriptionRequestSchema,
} from "@my-bookmark/shared";
import { type RequestHandler, Router } from "express";
import { appEnv } from "../lib/env";
import { supabaseAdmin } from "../lib/supabase";
import { getUserId, requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import {
  assertPushConfigured,
  createDefaultPushSender,
} from "../services/push-sender";

interface PushDb {
  subscriptionCount(userId: string): Promise<number>;
  upsertSubscription(input: {
    user_id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    user_agent: string | null;
  }): Promise<void>;
  deleteSubscriptions(userId: string, endpoint?: string): Promise<void>;
  subscriptionsForUser(userId: string): Promise<
    Array<{
      id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>
  >;
}

export const pushRouter = createPushRouter();

export function createPushRouter(
  getDb: () => PushDb = createSupabasePushDb,
  auth: RequestHandler = requireAuth(),
  options: { assertConfigured: () => void } = {
    assertConfigured: assertPushConfigured,
  },
): Router {
  const router = Router();

  router.use("/push", auth);

  router.get("/push/status", async (request, response) => {
    const userId = getUserId(request);
    const count = await getDb().subscriptionCount(userId);
    response.json({
      enabled: count > 0,
      subscriptionCount: count,
      vapidPublicKey: appEnv.VAPID_PUBLIC_KEY ?? null,
    });
  });

  router.post("/push/subscriptions", async (request, response) => {
    const userId = getUserId(request);
    options.assertConfigured();
    const body = pushSubscriptionRequestSchema.parse(request.body);
    await getDb().upsertSubscription({
      user_id: userId,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      user_agent: request.header("user-agent") ?? null,
    });
    response.status(201).send();
  });

  router.post("/push/unsubscribe", async (request, response) => {
    const userId = getUserId(request);
    const body = pushSubscriptionRequestSchema
      .partial()
      .parse(request.body ?? {});
    await getDb().deleteSubscriptions(userId, body.endpoint);
    response.status(204).send();
  });

  router.post("/push/test", async (request, response) => {
    const userId = getUserId(request);
    options.assertConfigured();
    const subscriptions = await getDb().subscriptionsForUser(userId);

    const sender = createDefaultPushSender();
    let sent = 0;
    let failed = 0;
    for (const row of subscriptions) {
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

  return router;
}

export function createSupabasePushDb(): PushDb {
  if (!supabaseAdmin) {
    throw new HttpError(
      500,
      API_ERROR_CODES.INTERNAL,
      "Database is not configured",
    );
  }
  const db = supabaseAdmin;
  return {
    async subscriptionCount(userId) {
      const { count, error } = await db
        .from("push_subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);
      if (error) {
        throw error;
      }
      return count ?? 0;
    },
    async upsertSubscription(input) {
      const { error } = await db.from("push_subscriptions").upsert(input, {
        onConflict: "endpoint",
      });
      if (error) {
        throw error;
      }
    },
    async deleteSubscriptions(userId, endpoint) {
      let builder = db
        .from("push_subscriptions")
        .delete()
        .eq("user_id", userId);
      if (endpoint) {
        builder = builder.eq("endpoint", endpoint);
      }
      const { error } = await builder;
      if (error) {
        throw error;
      }
    },
    async subscriptionsForUser(userId) {
      const { data, error } = await db
        .from("push_subscriptions")
        .select("id,endpoint,p256dh,auth")
        .eq("user_id", userId);
      if (error) {
        throw error;
      }
      return data ?? [];
    },
  };
}
