import { afterEach, describe, expect, it, vi } from "vitest";
import { createAiProvider, PRESET_MODEL } from "../index";
import { parseAnalyzeResponse } from "../schema";

const analysis = {
  category: { type: "new" as const, name: "💻 개발", confidence: 0.9 },
  summaryTitle: "React 19 핵심 변경 사항",
  summary: "React 19의 핵심 변경을 정리한다.",
  tags: ["React", "프론트엔드", "자바스크립트"],
};

function completionResponse(
  content: unknown,
  model = "google/gemini-3.1-flash-lite-20260507",
) {
  return new Response(
    JSON.stringify({
      model,
      choices: [
        {
          message: {
            content:
              typeof content === "string" ? content : JSON.stringify(content),
          },
        },
      ],
      usage: { is_byok: true },
    }),
    { status: 200 },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenRouter preset provider", () => {
  it("calls the preset with strict json_schema and returns the analysis outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completionResponse(analysis));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createAiProvider({ apiKey: "or-key" });

    const outcome = await provider.categorize({
      kind: "link",
      url: "https://example.com",
      existingCategories: [],
    });

    expect(outcome.analysis).toEqual(analysis);
    expect(outcome.model).toBe("google/gemini-3.1-flash-lite-20260507");
    expect(outcome.isByok).toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe(PRESET_MODEL);
    expect(body.max_tokens).toBe(2048);
    expect(body.provider).toEqual({ require_parameters: true });
    expect(body.response_format.json_schema.strict).toBe(true);
    // strict 규칙: category의 모든 property가 required
    expect(
      body.response_format.json_schema.schema.properties.category.required,
    ).toEqual(["type", "categoryId", "name", "confidence"]);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends private image data after the text prompt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completionResponse(analysis));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createAiProvider({ apiKey: "or-key" });

    await provider.categorize({
      kind: "image",
      image: { mimeType: "image/jpeg", base64: "AQID" },
      existingCategories: [{ id: "category-1", name: "🎨 디자인" }],
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.messages[1].content).toEqual([
      { type: "text", text: expect.stringContaining("existingCategories") },
      {
        type: "image_url",
        image_url: { url: "data:image/jpeg;base64,AQID" },
      },
    ]);
  });

  it("parses nullable category fields from strict output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        completionResponse({
          ...analysis,
          category: {
            type: "new",
            categoryId: null,
            name: "💻 개발",
            confidence: null,
          },
        }),
      ),
    );
    const provider = createAiProvider({ apiKey: "or-key" });
    const outcome = await provider.categorize({
      kind: "link",
      url: "https://example.com",
      existingCategories: [],
    });
    expect(outcome.analysis.category).toEqual({
      type: "new",
      name: "💻 개발",
      confidence: 0,
    });
  });

  it("throws with status attached on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 429 })),
    );
    const provider = createAiProvider({ apiKey: "or-key" });
    await expect(
      provider.categorize({
        kind: "link",
        url: "https://example.com",
        existingCategories: [],
      }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("validates the key against GET /key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createAiProvider({ apiKey: "k" }).validateConnection(),
    ).resolves.toBeUndefined();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://openrouter.ai/api/v1/key",
    );
  });
});

describe("AI analysis response parsing", () => {
  it("parses a complete analysis and rejects malformed analysis", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(parseAnalyzeResponse(analysis)).toEqual(analysis);
    expect(
      parseAnalyzeResponse({
        category: { type: "none" },
        summaryTitle: "가".repeat(41),
        tags: ["하나", "둘"],
      }),
    ).toBeNull();
    expect(
      parseAnalyzeResponse({
        ...analysis,
        category: { type: "new", name: "📰 국제 뉴스 요약", confidence: 0.7 },
      }),
    ).toEqual({
      ...analysis,
      category: { type: "new", name: "📰 국제 뉴스 요약", confidence: 0.7 },
    });
    expect(
      parseAnalyzeResponse({ ...analysis, summary: "가".repeat(301) }),
    ).toBeNull();
    warn.mockRestore();
  });
});
