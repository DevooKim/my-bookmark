import { afterEach, describe, expect, it, vi } from "vitest";
import { createAiProvider, PRESET_MODEL } from "../index";
import { CATEGORIZE_TIMEOUT_MS } from "../providers";
import { parseAnalyzeResponse, systemPrompt } from "../schema";

const analysis = {
  category: { type: "new" as const, name: "💻 개발", confidence: 0.9 },
  summaryTitle: "React 19 핵심 변경 사항",
  summary: "React 19의 핵심 변경을 정리한다.",
  tags: ["React", "프론트엔드", "자바스크립트"],
  places: [
    {
      name: "호랑이식당 성수점",
      locality: "서울 성동구",
      countryCode: "KR",
      confidence: 0.92,
    },
  ],
  source: null,
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
    expect(body.response_format.json_schema.schema.required).toContain(
      "places",
    );
    expect(
      body.response_format.json_schema.schema.properties.places,
    ).toMatchObject({
      type: "array",
      maxItems: 15,
      items: {
        required: ["name", "locality", "countryCode", "confidence"],
        additionalProperties: false,
      },
    });
    expect(body.response_format.json_schema.schema.required).toContain(
      "source",
    );
    expect(
      body.response_format.json_schema.schema.properties.source.required,
    ).toEqual(["platform", "handle", "postUrl", "repository", "confidence"]);
    expect(
      body.response_format.json_schema.schema.properties.tags,
    ).toMatchObject({ minItems: 2, maxItems: 5 });
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

  it("accepts analysis wrapped in a markdown code fence", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          completionResponse(
            `\`\`\`json\n${JSON.stringify(analysis, null, 2)}\n\`\`\``,
          ),
        ),
    );
    const provider = createAiProvider({ apiKey: "or-key" });

    const outcome = await provider.categorize({
      kind: "link",
      url: "https://example.com",
      existingCategories: [],
    });

    expect(outcome.analysis).toEqual(analysis);
  });

  it("embeds the response schema in the system prompt", () => {
    const prompt = systemPrompt();
    expect(prompt).toContain('"required":["category","summaryTitle"');
    expect(prompt).toContain("코드펜스");
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

describe("categorize timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function hangingFetch() {
    return vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
          // 느린 응답: 24초 뒤에 정상 응답이 도착한다.
          setTimeout(() => resolve(completionResponse(analysis)), 24_000);
        }),
    );
  }

  it("waits for a slow (24s) analysis instead of aborting at the 15s default", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch());
    const outcome = createAiProvider({ apiKey: "or-key" }).categorize({
      kind: "link",
      url: "https://example.com",
      existingCategories: [],
    });

    await vi.advanceTimersByTimeAsync(24_000);
    await expect(outcome).resolves.toMatchObject({ analysis });
  });

  it("aborts once the categorize timeout elapses", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    );
    const outcome = createAiProvider({ apiKey: "or-key" }).categorize({
      kind: "link",
      url: "https://example.com",
      existingCategories: [],
    });
    const assertion = expect(outcome).rejects.toMatchObject({
      name: "AbortError",
    });

    await vi.advanceTimersByTimeAsync(CATEGORIZE_TIMEOUT_MS);
    await assertion;
  });
});

describe("AI analysis response parsing", () => {
  it("accepts two focused tags and rejects a single padded tag", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(
      parseAnalyzeResponse({ ...analysis, tags: ["미소카츠", "천호"] }),
    ).toMatchObject({ tags: ["미소카츠", "천호"] });
    expect(
      parseAnalyzeResponse({ ...analysis, tags: ["미소카츠"] }),
    ).toBeNull();

    warn.mockRestore();
  });

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

  describe("places", () => {
    const place = analysis.places[0];

    it("parses several places in order", () => {
      const second = { ...place, name: "서촌 커피", countryCode: "kr" };
      expect(
        parseAnalyzeResponse({ ...analysis, places: [place, second] })?.places,
      ).toEqual([place, { ...second, countryCode: "KR" }]);
    });

    it("accepts an empty array, null, and a missing field", () => {
      expect(parseAnalyzeResponse({ ...analysis, places: [] })?.places).toEqual(
        [],
      );
      expect(
        parseAnalyzeResponse({ ...analysis, places: null })?.places,
      ).toBeNull();
      const { places: _omitted, ...withoutPlaces } = analysis;
      expect(parseAnalyzeResponse(withoutPlaces)?.places).toBeUndefined();
    });

    it("drops invalid items without failing the whole analysis", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = parseAnalyzeResponse({
        ...analysis,
        places: [
          { ...place, confidence: 1.1 },
          { ...place, name: " " },
          { ...place, countryCode: "Japan" },
          { name: "필드 누락" },
          "문자열",
          place,
        ],
      });
      expect(result?.places).toEqual([place]);
      warn.mockRestore();
    });

    it("keeps only the first 15 places", () => {
      const places = Array.from({ length: 20 }, (_, index) => ({
        ...place,
        name: `장소 ${index}`,
      }));
      const result = parseAnalyzeResponse({ ...analysis, places });
      expect(result?.places).toHaveLength(15);
      expect(result?.places?.at(-1)?.name).toBe("장소 14");
    });

    it("allows a null country code", () => {
      expect(
        parseAnalyzeResponse({
          ...analysis,
          places: [{ ...place, countryCode: null }],
        })?.places?.[0]?.countryCode,
      ).toBeNull();
    });
  });

  it("parses directly evidenced social and GitHub source candidates", () => {
    expect(
      parseAnalyzeResponse({
        ...analysis,
        source: {
          platform: "instagram",
          handle: "my.bookmark",
          postUrl: null,
          repository: null,
          confidence: 0.9,
        },
      }),
    ).toMatchObject({
      source: { platform: "instagram", handle: "my.bookmark" },
    });
    expect(
      parseAnalyzeResponse({
        ...analysis,
        source: {
          platform: "github",
          handle: "DevooKim",
          postUrl: null,
          repository: "DevooKim/my-bookmark",
          confidence: 0.95,
        },
      }),
    ).toMatchObject({
      source: {
        platform: "github",
        repository: "DevooKim/my-bookmark",
      },
    });
    expect(parseAnalyzeResponse({ ...analysis, source: null })).toMatchObject({
      source: null,
    });
  });

  it("rejects malformed source candidates", () => {
    expect(
      parseAnalyzeResponse({
        ...analysis,
        source: {
          platform: "facebook",
          handle: "account",
          postUrl: null,
          repository: null,
          confidence: 0.9,
        },
      }),
    ).toBeNull();
    expect(
      parseAnalyzeResponse({
        ...analysis,
        source: {
          platform: "youtube",
          handle: "channel",
          postUrl: null,
          repository: null,
          confidence: 1.1,
        },
      }),
    ).toBeNull();
  });

  it("forbids guessing places from photos or generic expressions", () => {
    const prompt = systemPrompt();
    expect(prompt).toContain("사진만 보고 장소 이름을 추측하지 않는다");
    expect(prompt).toContain("'서촌 카페', '교토 맛집'");
    expect(prompt).toContain("places는 빈 배열이다");
  });

  it("forbids guessing source accounts from names or logos", () => {
    expect(systemPrompt()).toContain(
      "handle, 게시물 URL·ID, GitHub owner/repository가 이미지에 직접 보일 때만 source를 반환한다",
    );
    expect(systemPrompt()).toContain(
      "표시명이나 로고만으로 계정을 추측하지 않는다",
    );
  });

  it("asks for a small, non-redundant tag set without restaurant names", () => {
    const prompt = systemPrompt();

    expect(prompt).toContain("태그 2개로 충분하면 2개에서 멈춘다");
    expect(prompt).toContain("TrueNAS와 NAS");
    expect(prompt).toContain("돈까스, 돈카츠, 미소카츠");
    expect(prompt).toContain("돈까스맛집, 천호맛집, 강동구맛집");
    expect(prompt).toContain("식당 상호와 지점명은 tags에서 제외한다");
  });
});
