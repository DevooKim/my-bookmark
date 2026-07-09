import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { requireAuth } from "../middleware/auth";
import { errorMiddleware } from "../middleware/error";
import { createPushRouter } from "../routes/push";

const userId = "11111111-1111-4111-8111-111111111111";

class FakePushDb {
  subscriptions: Array<{
    user_id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    user_agent: string | null;
  }> = [];

  subscriptionCount(userIdValue: string) {
    return Promise.resolve(
      this.subscriptions.filter((item) => item.user_id === userIdValue).length,
    );
  }

  upsertSubscription(input: {
    user_id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    user_agent: string | null;
  }) {
    this.subscriptions = this.subscriptions.filter(
      (item) => item.endpoint !== input.endpoint,
    );
    this.subscriptions.push(input);
    return Promise.resolve();
  }

  deleteSubscriptions(userIdValue: string, endpoint?: string) {
    this.subscriptions = this.subscriptions.filter(
      (item) =>
        item.user_id !== userIdValue ||
        (endpoint !== undefined && item.endpoint !== endpoint),
    );
    return Promise.resolve();
  }

  subscriptionsForUser(userIdValue: string) {
    return Promise.resolve(
      this.subscriptions
        .filter((item) => item.user_id === userIdValue)
        .map((item, index) => ({ id: `sub-${index}`, ...item })),
    );
  }
}

function createTestApp(db: FakePushDb) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createPushRouter(() => db, requireAuth({ bearer: async () => userId }), {
      assertConfigured: () => undefined,
    }),
  );
  app.use(errorMiddleware);
  return app;
}

describe("push routes", () => {
  it("creates or updates a push subscription with 201", async () => {
    const db = new FakePushDb();
    const app = createTestApp(db);

    const response = await request(app)
      .post("/api/push/subscriptions")
      .set("Authorization", "Bearer test-token")
      .set("user-agent", "test-agent")
      .send({
        endpoint: "https://push.example/subscription",
        keys: { p256dh: "p256dh", auth: "auth" },
      });

    expect(response.status).toBe(201);
    expect(db.subscriptions).toEqual([
      {
        user_id: userId,
        endpoint: "https://push.example/subscription",
        p256dh: "p256dh",
        auth: "auth",
        user_agent: "test-agent",
      },
    ]);
  });
});
