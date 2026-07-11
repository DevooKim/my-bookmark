import { describe, expect, it } from "vitest";
import {
  AI_MODEL_CATALOG,
  aiConnectionTestResponseSchema,
  aiStatusResponseSchema,
  saveAiProviderKeyRequestSchema,
  selectAiModelRequestSchema,
} from "../index";

describe("AI settings schemas", () => {
  it("provides two fixed low-cost or balanced models per provider", () => {
    expect(AI_MODEL_CATALOG).toEqual([
      {
        provider: "gemini",
        model: "gemini-flash-lite-latest",
        label: "Gemini Flash Lite",
        tier: "저비용",
      },
      {
        provider: "gemini",
        model: "gemini-flash-latest",
        label: "Gemini Flash",
        tier: "균형",
      },
      {
        provider: "anthropic",
        model: "claude-haiku-4-5",
        label: "Claude Haiku 4.5",
        tier: "저비용",
      },
      {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        label: "Claude Sonnet 4.6",
        tier: "균형",
      },
      {
        provider: "openai",
        model: "gpt-4o-mini",
        label: "GPT-4o mini",
        tier: "저비용",
      },
      {
        provider: "openai",
        model: "gpt-5.4-mini",
        label: "GPT-5.4 mini",
        tier: "균형",
      },
    ]);
  });

  it("parses selected model and provider configuration without credentials", () => {
    expect(
      aiStatusResponseSchema.parse({
        provider: "openai",
        model: "gpt-4o-mini",
        enabled: true,
        providers: {
          gemini: { configured: false },
          anthropic: { configured: false },
          openai: { configured: true },
        },
      }),
    ).toMatchObject({ provider: "openai", model: "gpt-4o-mini" });
  });

  it("parses provider-key requests independently from model selection", () => {
    expect(
      saveAiProviderKeyRequestSchema.parse({ apiKey: " secret-key " }),
    ).toEqual({ apiKey: "secret-key" });
    expect(() =>
      saveAiProviderKeyRequestSchema.parse({ apiKey: " " }),
    ).toThrow();
    expect(() =>
      saveAiProviderKeyRequestSchema.parse({ apiKey: "x".repeat(513) }),
    ).toThrow();
  });

  it("accepts valid model selections and rejects mismatched pairs", () => {
    expect(
      selectAiModelRequestSchema.parse({
        provider: "gemini",
        model: "gemini-flash-latest",
      }),
    ).toEqual({ provider: "gemini", model: "gemini-flash-latest" });
    expect(() =>
      selectAiModelRequestSchema.parse({
        provider: "gemini",
        model: "gpt-4o-mini",
      }),
    ).toThrow();
  });

  it("parses connection test results", () => {
    expect(
      aiConnectionTestResponseSchema.parse({ provider: "openai", ok: true }),
    ).toEqual({ provider: "openai", ok: true });
  });
});
