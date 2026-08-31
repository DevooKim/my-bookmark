import "../src/lib/load-env";
import { fileURLToPath } from "node:url";
import type { EmbeddingProvider } from "@my-bookmark/ai";
import { z } from "zod";
import { createSupabaseAdminClient } from "../src/lib/supabase";
import { buildEmbeddingText } from "../src/services/embedding";
import { getEmbeddingProvider } from "../src/services/embedding-provider";

export const EMBEDDING_BATCH_SIZE = 100;
const QUERY_PAGE_SIZE = 500;

const backfillBookmarkSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullable(),
  description: z.string().nullable(),
  tags: z.array(z.string()),
});

export type BackfillBookmark = z.infer<typeof backfillBookmarkSchema>;

export interface BackfillStore {
  findMissingBookmarks(limit?: number): Promise<BackfillBookmark[]>;
  updateEmbedding(bookmarkId: string, embedding: number[]): Promise<void>;
}

interface BackfillSelectQuery {
  is(column: "embedding", value: null): BackfillSelectQuery;
  range(from: number, to: number): PromiseLike<BackfillSelectResult>;
}

interface BackfillSelectResult {
  data: unknown;
  error: { message?: string } | null;
}

interface BackfillUpdateQuery {
  eq(
    column: "id",
    value: string,
  ): PromiseLike<{ error: { message?: string } | null }>;
}

interface BackfillSupabaseClient {
  from(table: "bookmarks"): {
    select(columns: string): BackfillSelectQuery;
    update(values: { embedding: number[] }): BackfillUpdateQuery;
  };
}

export interface BackfillLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface BackfillArgs {
  dryRun: boolean;
  limit?: number;
}

export interface BackfillResult {
  candidates: number;
  embedded: number;
  failed: number;
  dryRun: boolean;
}

export function isBackfillEntrypoint(
  moduleUrl: string,
  argvPath: string | undefined,
): boolean {
  return argvPath !== undefined && fileURLToPath(moduleUrl) === argvPath;
}

export function parseBackfillArgs(argv: string[]): BackfillArgs {
  let dryRun = false;
  let limit: number | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--limit") {
      limit = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error("--limit must be a positive integer");
  }

  return { dryRun, ...(limit === undefined ? {} : { limit }) };
}

export function createSupabaseBackfillStore(
  supabase: BackfillSupabaseClient,
): BackfillStore {
  return {
    async findMissingBookmarks(limit) {
      const query = supabase
        .from("bookmarks")
        .select("id,title,description,tags")
        .is("embedding", null);
      const pageSize =
        limit === undefined
          ? QUERY_PAGE_SIZE
          : Math.min(limit, QUERY_PAGE_SIZE);
      const bookmarks: BackfillBookmark[] = [];

      for (let offset = 0; ; offset += pageSize) {
        const result = await query.range(offset, offset + pageSize - 1);
        if (result.error) {
          throw result.error;
        }
        const page = backfillBookmarkSchema.array().parse(result.data ?? []);
        bookmarks.push(...page);
        if (
          page.length < pageSize ||
          (limit !== undefined && bookmarks.length >= limit)
        ) {
          return limit === undefined ? bookmarks : bookmarks.slice(0, limit);
        }
      }
    },
    async updateEmbedding(bookmarkId, embedding) {
      const { error } = await supabase
        .from("bookmarks")
        .update({ embedding })
        .eq("id", bookmarkId);
      if (error) {
        throw error;
      }
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runBackfill(input: {
  store: BackfillStore;
  provider: EmbeddingProvider | null;
  args: BackfillArgs;
  logger: BackfillLogger;
}): Promise<BackfillResult> {
  const bookmarks = await input.store.findMissingBookmarks(input.args.limit);
  const result: BackfillResult = {
    candidates: bookmarks.length,
    embedded: 0,
    failed: 0,
    dryRun: input.args.dryRun,
  };

  if (input.args.dryRun) {
    input.logger.info(
      `Embedding backfill dry run: ${result.candidates} bookmark(s) would be processed`,
    );
    return result;
  }

  const provider = input.provider;
  if (!provider) {
    throw new Error("OPEN_ROUTER_API_KEY is required for embedding backfill");
  }

  const failureReasons = new Map<string, number>();
  const recordFailure = (bookmarkId: string, error: unknown) => {
    const reason = errorMessage(error);
    result.failed += 1;
    failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
    input.logger.warn(
      `Embedding backfill failed for bookmark ${bookmarkId}: ${reason}`,
    );
  };

  const writeEmbedding = async (
    bookmark: BackfillBookmark,
    embedding: number[],
  ): Promise<void> => {
    try {
      await input.store.updateEmbedding(bookmark.id, embedding);
      result.embedded += 1;
    } catch (error) {
      recordFailure(bookmark.id, error);
    }
  };

  const retryBookmarkIndividually = async (
    bookmark: BackfillBookmark,
  ): Promise<void> => {
    try {
      const embedding = await provider.embed({
        text: buildEmbeddingText(bookmark),
      });
      await writeEmbedding(bookmark, embedding);
    } catch (error) {
      recordFailure(bookmark.id, error);
    }
  };

  for (
    let offset = 0;
    offset < bookmarks.length;
    offset += EMBEDDING_BATCH_SIZE
  ) {
    const batch = bookmarks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    let embeddings: number[][];
    try {
      embeddings = await provider.embed({
        text: batch.map(buildEmbeddingText),
      });
      if (embeddings.length !== batch.length) {
        throw new Error(
          `Embedding provider returned ${embeddings.length} vectors for ${batch.length} bookmarks`,
        );
      }
    } catch (error) {
      input.logger.warn(
        `Embedding batch failed for ${batch.length} bookmark(s); retrying individually: ${errorMessage(error)}`,
      );
      for (const bookmark of batch) {
        await retryBookmarkIndividually(bookmark);
      }
      continue;
    }

    for (let index = 0; index < batch.length; index += 1) {
      const bookmark = batch[index];
      const embedding = embeddings[index];
      if (!bookmark || !embedding) {
        recordFailure(
          bookmark?.id ?? `batch-offset-${offset + index}`,
          new Error("Embedding provider returned an incomplete batch"),
        );
        continue;
      }
      await writeEmbedding(bookmark, embedding);
    }
  }

  const reasons = [...failureReasons.entries()]
    .map(([reason, count]) => `${reason} (${count})`)
    .join(", ");
  input.logger.info(
    `Embedding backfill summary: candidates=${result.candidates}, embedded=${result.embedded}, failed=${result.failed}${reasons ? `; reasons=${reasons}` : ""}`,
  );
  return result;
}

async function main(): Promise<void> {
  const args = parseBackfillArgs(process.argv.slice(2));
  const supabase = createSupabaseAdminClient();
  const provider = getEmbeddingProvider();
  const result = await runBackfill({
    store: createSupabaseBackfillStore(supabase),
    provider,
    args,
    logger: console,
  });

  if (!args.dryRun && result.failed > 0) {
    process.exitCode = 1;
  }
}

if (isBackfillEntrypoint(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(`Embedding backfill aborted: ${errorMessage(error)}`);
    process.exitCode = 1;
  });
}
