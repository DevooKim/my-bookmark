import { describe, expect, it, vi } from "vitest";
import {
  type AiProvider,
  createAiProvider,
  parseCategorizeResponse,
} from "../index";

describe("AI provider contract", () => {
  it("describes a categorize interface", async () => {
    const provider: AiProvider = {
      name: "fake",
      categorize: async () => ({
        type: "existing",
        categoryId: "dev",
        confidence: 0.9,
      }),
    };

    await expect(
      provider.categorize({
        url: "https://example.com",
        existingCategories: [],
      }),
    ).resolves.toEqual({
      type: "existing",
      categoryId: "dev",
      confidence: 0.9,
    });
  });

  it("parses existing, new, none, and falls back on malformed responses", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(
      parseCategorizeResponse({
        type: "existing",
        categoryId: "1",
        confidence: 1,
      }),
    ).toEqual({
      type: "existing",
      categoryId: "1",
      confidence: 1,
    });
    expect(
      parseCategorizeResponse({ type: "new", name: "개발", confidence: 0.7 }),
    ).toEqual({
      type: "new",
      name: "개발",
      confidence: 0.7,
    });
    expect(parseCategorizeResponse({ type: "none" })).toEqual({ type: "none" });
    expect(
      parseCategorizeResponse({
        type: "new",
        name: "너무길어서실패하는카테고리",
        confidence: 2,
      }),
    ).toEqual({
      type: "none",
    });
    warn.mockRestore();
  });

  it("creates the selected provider", () => {
    expect(createAiProvider({ provider: "gemini", apiKey: "test" }).name).toBe(
      "gemini",
    );
    expect(
      createAiProvider({ provider: "anthropic", apiKey: "test" }).name,
    ).toBe("anthropic");
    expect(createAiProvider({ provider: "openai", apiKey: "test" }).name).toBe(
      "openai",
    );
  });
});
