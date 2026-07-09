import { describe, expect, it, vi } from "vitest";

vi.mock("./api-client", () => ({
  savePushSubscription: vi.fn(),
  unsubscribePush: vi.fn(),
}));

import { urlBase64ToUint8Array } from "./push";

describe("push subscription helpers", () => {
  it("converts URL-safe VAPID public keys into bytes", () => {
    const bytes = urlBase64ToUint8Array("AQIDBA");

    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
  });
});
