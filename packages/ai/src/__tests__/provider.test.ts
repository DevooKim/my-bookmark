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
      validateConnection: async () => undefined,
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

  it("parses Gemini structured JSON responses and passes an abort signal", async () => {
    sdkMocks.geminiGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        type: "existing",
        categoryId: "cat-dev",
        confidence: 0.91,
      }),
    });

    const provider = createAiProvider({ provider: "gemini", apiKey: "test" });

    await expect(
      provider.categorize({
        url: "https://example.com",
        title: "React 19",
        existingCategories: [{ id: "cat-dev", name: "개발" }],
      }),
    ).resolves.toEqual({
      type: "existing",
      categoryId: "cat-dev",
      confidence: 0.91,
    });
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
          input: { type: "new", name: "디자인", confidence: 0.82 },
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
    ).resolves.toEqual({ type: "new", name: "디자인", confidence: 0.82 });
    expect(sdkMocks.anthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: { type: "tool", name: "categorize_bookmark" },
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("parses OpenAI structured output responses", async () => {
    sdkMocks.openAiParse.mockResolvedValueOnce({
      output_parsed: { result: { type: "none" } },
    });

    const provider = createAiProvider({ provider: "openai", apiKey: "test" });

    await expect(
      provider.categorize({
        url: "https://example.com",
        existingCategories: [],
      }),
    ).resolves.toEqual({ type: "none" });
    expect(sdkMocks.openAiParse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.objectContaining({
          format: expect.objectContaining({ name: "bookmark_category" }),
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

  it("falls back to none when provider output parsing fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    sdkMocks.geminiGenerateContent.mockResolvedValueOnce({ text: "not json" });

    const provider = createAiProvider({ provider: "gemini", apiKey: "test" });

    await expect(
      provider.categorize({
        url: "https://example.com",
        existingCategories: [],
      }),
    ).resolves.toEqual({ type: "none" });
    warn.mockRestore();
  });
});
