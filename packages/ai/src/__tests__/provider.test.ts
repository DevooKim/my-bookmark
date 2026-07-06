import { describe, expect, it } from "vitest";
import type { AiProvider } from "../index";

describe("AiProvider", () => {
  it("describes a classify interface", async () => {
    const provider: AiProvider = {
      classify: async () => ({ categoryName: "Tech", confidence: 0.9 }),
    };

    await expect(
      provider.classify({ url: "https://example.com" }),
    ).resolves.toEqual({
      categoryName: "Tech",
      confidence: 0.9,
    });
  });
});
