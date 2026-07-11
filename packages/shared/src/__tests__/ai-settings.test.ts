import { describe, expect, it } from "vitest";
import {
  aiStatusResponseSchema,
  updateAiSettingsRequestSchema,
} from "../index";

describe("AI settings schemas", () => {
  it("parses provider configuration without credentials", () => {
    expect(
      aiStatusResponseSchema.parse({
        provider: "openai",
        enabled: true,
        providers: {
          gemini: { configured: false },
          anthropic: { configured: false },
          openai: { configured: true },
        },
      }),
    ).toEqual({
      provider: "openai",
      enabled: true,
      providers: {
        gemini: { configured: false },
        anthropic: { configured: false },
        openai: { configured: true },
      },
    });
  });

  it("accepts provider-only updates and bounded non-blank keys", () => {
    expect(updateAiSettingsRequestSchema.parse({ provider: "gemini" })).toEqual(
      { provider: "gemini" },
    );
    expect(
      updateAiSettingsRequestSchema.parse({
        provider: "anthropic",
        apiKey: " secret-key ",
      }),
    ).toEqual({ provider: "anthropic", apiKey: "secret-key" });
  });

  it("rejects blank and oversized keys", () => {
    expect(() =>
      updateAiSettingsRequestSchema.parse({ provider: "gemini", apiKey: " " }),
    ).toThrow();
    expect(() =>
      updateAiSettingsRequestSchema.parse({
        provider: "gemini",
        apiKey: "x".repeat(513),
      }),
    ).toThrow();
  });
});
