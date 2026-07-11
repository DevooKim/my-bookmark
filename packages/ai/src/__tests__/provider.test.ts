import { describe, expect, it, vi } from "vitest";

const sdkMocks = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  anthropicListModels: vi.fn(),
  geminiGenerateContent: vi.fn(),
  geminiListModels: vi.fn(),
  openAiListModels: vi.fn(),
  openAiParse: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function GoogleGenAI() {
    return {
      models: {
        generateContent: sdkMocks.geminiGenerateContent,
        list: sdkMocks.geminiListModels,
      },
    };
  }),
  Type: {
    ARRAY: "array",
    NUMBER: "number",
    OBJECT: "object",
    STRING: "string",
  },
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(function Anthropic() {
    return {
      messages: { create: sdkMocks.anthropicCreate },
      models: { list: sdkMocks.anthropicListModels },
    };
  }),
}));

vi.mock("openai", () => ({
  default: vi.fn(function OpenAI() {
    return {
      responses: { parse: sdkMocks.openAiParse },
      models: { list: sdkMocks.openAiListModels },
    };
  }),
}));

vi.mock("openai/helpers/zod", () => ({
  zodTextFormat: vi.fn((schema, name) => ({ name, schema })),
}));

import { type AiProvider, createAiProvider } from "../index";
import { parseAnalyzeResponse } from "../schema";

const expected = {
  category: {
    type: "existing" as const,
    categoryId: "cat-dev",
    confidence: 0.91,
  },
  summaryTitle: "React 19 핵심 변경 사항",
  tags: ["React", "프론트엔드", "자바스크립트"],
};

describe("AI provider contract", () => {
  it("describes a categorize interface", async () => {
    const provider: AiProvider = {
      name: "fake",
      categorize: async () => expected,
      validateConnection: async () => undefined,
    };

    await expect(
      provider.categorize({
        url: "https://example.com",
        existingCategories: [],
      }),
    ).resolves.toEqual(expected);
  });

  it("parses a complete analysis and rejects malformed analysis", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(parseAnalyzeResponse(expected)).toEqual(expected);
    expect(
      parseAnalyzeResponse({
        category: { type: "none" },
        summaryTitle: "가".repeat(41),
        tags: ["하나", "둘"],
      }),
    ).toBeNull();
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

  it("parses Gemini structured JSON responses and passes an abort signal", async () => {
    sdkMocks.geminiGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify(expected),
    });

    const provider = createAiProvider({ provider: "gemini", apiKey: "test" });

    await expect(
      provider.categorize({
        url: "https://example.com",
        title: "React 19",
        existingCategories: [{ id: "cat-dev", name: "개발" }],
      }),
    ).resolves.toEqual(expected);
    expect(sdkMocks.geminiGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          abortSignal: expect.any(AbortSignal),
          responseMimeType: "application/json",
        }),
      }),
    );
  });

  it("parses Anthropic forced tool-use responses", async () => {
    sdkMocks.anthropicCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          input: expected,
        },
      ],
    });

    const provider = createAiProvider({
      provider: "anthropic",
      apiKey: "test",
    });

    await expect(
      provider.categorize({
        url: "https://example.com",
        existingCategories: [],
      }),
    ).resolves.toEqual(expected);
    expect(sdkMocks.anthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: { type: "tool", name: "analyze_bookmark" },
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("parses OpenAI structured output responses", async () => {
    sdkMocks.openAiParse.mockResolvedValueOnce({
      output_parsed: expected,
    });

    const provider = createAiProvider({ provider: "openai", apiKey: "test" });

    await expect(
      provider.categorize({
        url: "https://example.com",
        existingCategories: [],
      }),
    ).resolves.toEqual(expected);
    expect(sdkMocks.openAiParse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.objectContaining({
          format: expect.objectContaining({ name: "bookmark_analysis" }),
        }),
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("validates provider connections through Models APIs without inference", async () => {
    sdkMocks.geminiGenerateContent.mockClear();
    sdkMocks.anthropicCreate.mockClear();
    sdkMocks.openAiParse.mockClear();
    sdkMocks.geminiListModels.mockResolvedValueOnce({});
    sdkMocks.anthropicListModels.mockResolvedValueOnce({});
    sdkMocks.openAiListModels.mockResolvedValueOnce({});

    await createAiProvider({
      provider: "gemini",
      apiKey: "test",
    }).validateConnection();
    await createAiProvider({
      provider: "anthropic",
      apiKey: "test",
    }).validateConnection();
    await createAiProvider({
      provider: "openai",
      apiKey: "test",
    }).validateConnection();

    expect(sdkMocks.geminiListModels).toHaveBeenCalledWith({
      config: {
        pageSize: 1,
        abortSignal: expect.any(AbortSignal),
      },
    });
    expect(sdkMocks.anthropicListModels).toHaveBeenCalledWith(
      { limit: 1 },
      { signal: expect.any(AbortSignal) },
    );
    expect(sdkMocks.openAiListModels).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
    expect(sdkMocks.geminiGenerateContent).not.toHaveBeenCalled();
    expect(sdkMocks.anthropicCreate).not.toHaveBeenCalled();
    expect(sdkMocks.openAiParse).not.toHaveBeenCalled();
  });

  it.each([
    [
      "gemini",
      () =>
        sdkMocks.geminiGenerateContent.mockResolvedValueOnce({
          text: "not json",
        }),
    ],
    [
      "anthropic",
      () =>
        sdkMocks.anthropicCreate.mockResolvedValueOnce({
          content: [
            { type: "tool_use", input: { category: { type: "none" } } },
          ],
        }),
    ],
    [
      "openai",
      () => sdkMocks.openAiParse.mockResolvedValueOnce({ output_parsed: null }),
    ],
  ] as const)("throws when %s output is malformed", async (providerName, arrange) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    arrange();

    const provider = createAiProvider({
      provider: providerName,
      apiKey: "test",
    });

    await expect(
      provider.categorize({
        url: "https://example.com",
        existingCategories: [],
      }),
    ).rejects.toThrow("AI analysis response is malformed");
    warn.mockRestore();
  });
});
