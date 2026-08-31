import { pathToFileURL } from "node:url";
import type { EmbeddingProvider } from "@my-bookmark/ai";
import { describe, expect, it, vi } from "vitest";
import {
  type BackfillBookmark,
  type BackfillLogger,
  createSupabaseBackfillStore,
  EMBEDDING_BATCH_SIZE,
  isBackfillEntrypoint,
  parseBackfillArgs,
  runBackfill,
} from "../../scripts/backfill-embeddings";

function bookmark(id: string): BackfillBookmark {
  return {
    id,
    title: `제목 ${id}`,
    description: `설명 ${id}`,
    tags: [`태그 ${id}`],
  };
}

function createProvider(
  handler: (texts: string[]) => Promise<number[][]>,
): EmbeddingProvider {
  function embed(input: { text: string }): Promise<number[]>;
  function embed(input: { text: string[] }): Promise<number[][]>;
  async function embed(input: {
    text: string | string[];
  }): Promise<number[] | number[][]> {
    const embeddings = await handler(
      Array.isArray(input.text) ? input.text : [input.text],
    );
    return Array.isArray(input.text) ? embeddings : (embeddings[0] ?? []);
  }
  return { embed };
}

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  } satisfies BackfillLogger;
}

describe("backfill embeddings", () => {
  it("selects only rows whose embedding is null", async () => {
    const rows = [bookmark("missing")];
    const query = {
      is: vi.fn(),
      range: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };
    query.is.mockReturnValue(query);
    const select = vi.fn().mockReturnValue(query);
    const update = vi.fn();
    const client = {
      from: vi.fn().mockReturnValue({ select, update }),
    };
    const store = createSupabaseBackfillStore(client);

    await expect(store.findMissingBookmarks(3)).resolves.toEqual(rows);
    expect(select).toHaveBeenCalledWith("id,title,description,tags");
    expect(query.is).toHaveBeenCalledWith("embedding", null);
    expect(query.range).toHaveBeenCalledWith(0, 2);
    expect(update).not.toHaveBeenCalled();
  });

  it("paginates an unbounded selection beyond one query page", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) =>
      bookmark(String(index)),
    );
    const secondPage = [bookmark("500")];
    const query = {
      is: vi.fn(),
      range: vi.fn((from: number) =>
        Promise.resolve({
          data: from === 0 ? firstPage : secondPage,
          error: null,
        }),
      ),
    };
    query.is.mockReturnValue(query);
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue(query),
        update: vi.fn(),
      }),
    };

    const store = createSupabaseBackfillStore(client);
    const rows = await store.findMissingBookmarks();

    expect(rows).toHaveLength(501);
    expect(query.range).toHaveBeenNthCalledWith(1, 0, 499);
    expect(query.range).toHaveBeenNthCalledWith(2, 500, 999);
  });

  it("does not embed or write during a dry run", async () => {
    const provider = createProvider(async () => {
      throw new Error("must not be called");
    });
    const updateEmbedding = vi.fn();
    const logger = createLogger();

    const result = await runBackfill({
      store: {
        findMissingBookmarks: async () => [bookmark("one")],
        updateEmbedding,
      },
      provider,
      args: { dryRun: true },
      logger,
    });

    expect(result).toMatchObject({ candidates: 1, embedded: 0, failed: 0 });
    expect(updateEmbedding).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "Embedding backfill dry run: 1 bookmark(s) would be processed",
    );
  });

  it("validates the command-line argument contract", () => {
    expect(parseBackfillArgs(["--dry-run", "--limit", "5"])).toEqual({
      dryRun: true,
      limit: 5,
    });
    for (const args of [
      ["--limit"],
      ["--limit", "abc"],
      ["--limit", "0"],
      ["--limit", "-1"],
      ["--limit=5"],
      ["--unknown"],
    ]) {
      expect(() => parseBackfillArgs(args)).toThrow();
    }
  });

  it("recognizes the direct tsx entrypoint without import.meta.main", () => {
    const modulePath = "/tmp/backfill-embeddings.ts";
    expect(
      isBackfillEntrypoint(pathToFileURL(modulePath).href, modulePath),
    ).toBe(true);
    expect(
      isBackfillEntrypoint(pathToFileURL(modulePath).href, undefined),
    ).toBe(false);
  });

  it("passes --limit through to missing-row selection", async () => {
    const findMissingBookmarks = vi
      .fn()
      .mockResolvedValue([bookmark("one"), bookmark("two")]);
    const embed = vi.fn();
    const provider = createProvider(async (texts) => {
      embed(texts);
      return texts.map(() => [1]);
    });

    await runBackfill({
      store: {
        findMissingBookmarks,
        updateEmbedding: vi.fn().mockResolvedValue(undefined),
      },
      provider,
      args: { dryRun: false, limit: 2 },
      logger: createLogger(),
    });

    expect(findMissingBookmarks).toHaveBeenCalledWith(2);
    expect(embed).toHaveBeenCalledWith([
      "제목 one\n설명 one\n태그 one",
      "제목 two\n설명 two\n태그 two",
    ]);
  });

  it("uses the provider batch input and isolates a toxic row", async () => {
    const rows = Array.from({ length: EMBEDDING_BATCH_SIZE + 1 }, (_, index) =>
      bookmark(String(index)),
    );
    const batchCalls: string[][] = [];
    const provider = createProvider(async (texts) => {
      batchCalls.push(texts);
      if (texts.length === EMBEDDING_BATCH_SIZE) {
        throw new Error("temporary embedding failure");
      }
      if (texts[0]?.includes("제목 0")) {
        throw new Error("toxic bookmark");
      }
      return texts.map(() => [1]);
    });
    const updateEmbedding = vi.fn().mockResolvedValue(undefined);
    const logger = createLogger();

    const result = await runBackfill({
      store: {
        findMissingBookmarks: async () => rows,
        updateEmbedding,
      },
      provider,
      args: { dryRun: false },
      logger,
    });

    expect(batchCalls[0]).toHaveLength(EMBEDDING_BATCH_SIZE);
    expect(batchCalls.at(-1)).toHaveLength(1);
    expect(batchCalls.slice(1, -1).every((call) => call.length === 1)).toBe(
      true,
    );
    expect(updateEmbedding).toHaveBeenCalledTimes(EMBEDDING_BATCH_SIZE);
    expect(result).toMatchObject({
      candidates: EMBEDDING_BATCH_SIZE + 1,
      embedded: EMBEDDING_BATCH_SIZE,
      failed: 1,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("temporary embedding failure"),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("toxic bookmark"),
    );
  });

  it("continues writing other rows when one database update fails", async () => {
    const rows = [bookmark("first"), bookmark("second"), bookmark("third")];
    const updateEmbedding = vi.fn(async (id: string) => {
      if (id === "second") {
        throw new Error("database write failure");
      }
    });

    const result = await runBackfill({
      store: {
        findMissingBookmarks: async () => rows,
        updateEmbedding,
      },
      provider: createProvider(async (texts) => texts.map(() => [1])),
      args: { dryRun: false },
      logger: createLogger(),
    });

    expect(updateEmbedding).toHaveBeenCalledTimes(3);
    expect(updateEmbedding.mock.calls.map(([id]) => id)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(result).toMatchObject({ candidates: 3, embedded: 2, failed: 1 });
  });
});
