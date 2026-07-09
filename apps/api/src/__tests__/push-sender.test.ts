import { describe, expect, it, vi } from "vitest";
import { createPushSender } from "../services/push-sender";

const subscription = {
  id: "sub-1",
  endpoint: "https://push.example/sub-1",
  keys: { auth: "auth-token", p256dh: "public-key" },
};

const payload = {
  title: "🔖 Example",
  body: "example.com",
  url: "https://example.com/article",
};

describe("push sender", () => {
  it("sends JSON payloads to a subscription", async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const sender = createPushSender({
      sendNotification,
      deleteSubscription: vi.fn(),
    });

    const result = await sender.send(subscription, payload);

    expect(result).toEqual({ ok: true });
    expect(sendNotification).toHaveBeenCalledWith(
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
      JSON.stringify(payload),
    );
  });

  it("deletes expired subscriptions when push service returns 410", async () => {
    const error = Object.assign(new Error("Gone"), { statusCode: 410 });
    const deleteSubscription = vi.fn().mockResolvedValue(undefined);
    const sender = createPushSender({
      sendNotification: vi.fn().mockRejectedValue(error),
      deleteSubscription,
    });

    const result = await sender.send(subscription, payload);

    expect(result).toEqual({ ok: false, expired: true });
    expect(deleteSubscription).toHaveBeenCalledWith(subscription.id);
  });
});
