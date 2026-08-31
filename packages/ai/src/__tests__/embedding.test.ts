import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmbeddingProvider,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
} from "../index";

function vector(seed: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) =>
    index === 0 ? seed : 0,
  );
}

function embeddingResponse(
  data: Array<{ index: number; embedding: number[] }>,
): Response {
  return new Response(JSON.stringify({ data }), { status: 200 });
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenRouter embedding provider", () => {
  it("embeds one document with the configured model", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        embeddingResponse([{ index: 0, embedding: vector(1) }]),
      );
    vi.stubGlobal("fetch", fetchMock);
    const provider = createEmbeddingProvider({ apiKey: "or-key" });

    const result = await provider.embed({
      text: "제목\n설명",
    });

    expect(result).toEqual(vector(1));
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("https://openrouter.ai/api/v1/embeddings");
    const init = call?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      model: EMBEDDING_MODEL,
      input: "제목\n설명",
      encoding_format: "float",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("supports batches and restores the provider index order", async () => {
    const first = vector(1);
    const second = vector(2);
    const fetchMock = vi.fn().mockResolvedValue(
      embeddingResponse([
        { index: 1, embedding: second },
        { index: 0, embedding: first },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = createEmbeddingProvider({ apiKey: "or-key" });

    const result = await provider.embed({
      text: ["첫 번째", "두 번째"],
    });

    expect(result).toEqual([first, second]);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: EMBEDDING_MODEL,
      input: ["첫 번째", "두 번째"],
    });
  });

  it("returns an empty batch without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = createEmbeddingProvider({ apiKey: "or-key" });

    await expect(provider.embed({ text: [] })).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-success response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 429 })),
    );
    const provider = createEmbeddingProvider({ apiKey: "or-key" });

    await expect(provider.embed({ text: "문서" })).rejects.toMatchObject({
      status: 429,
    });
  });

  it("rejects malformed vectors at the response boundary", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          embeddingResponse([{ index: 0, embedding: [0.1, 0.2] }]),
        ),
    );
    const provider = createEmbeddingProvider({ apiKey: "or-key" });

    await expect(provider.embed({ text: "문서" })).rejects.toThrow();
  });
});
