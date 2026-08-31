import "../src/lib/load-env";
import type { EmbeddingProvider } from "@my-bookmark/ai";
import { z } from "zod";
import { createSupabaseAdminClient } from "../src/lib/supabase";
import { buildEmbeddingText } from "../src/services/embedding";
import { getEmbeddingProvider } from "../src/services/embedding-provider";

export const EMBEDDING_BATCH_SIZE = 100;

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
  limit(count: number): BackfillSelectQuery;
  then<TResult1 = BackfillSelectResult, TResult2 = never>(
    onfulfilled?:
      | ((value: BackfillSelectResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
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
      const result =
        limit === undefined ? await query : await query.limit(limit);
      if (result.error) {
        throw result.error;
      }
      return backfillBookmarkSchema.array().parse(result.data ?? []);
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

  if (!input.provider) {
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

  for (
    let offset = 0;
    offset < bookmarks.length;
    offset += EMBEDDING_BATCH_SIZE
  ) {
    const batch = bookmarks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    let embeddings: number[][];
    try {
      embeddings = await input.provider.embed({
        text: batch.map(buildEmbeddingText),
      });
      if (embeddings.length !== batch.length) {
        throw new Error(
          `Embedding provider returned ${embeddings.length} vectors for ${batch.length} bookmarks`,
        );
      }
    } catch (error) {
      for (const bookmark of batch) {
        recordFailure(bookmark.id, error);
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
      try {
        await input.store.updateEmbedding(bookmark.id, embedding);
        result.embedded += 1;
      } catch (error) {
        recordFailure(bookmark.id, error);
      }
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

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`Embedding backfill aborted: ${errorMessage(error)}`);
    process.exitCode = 1;
  });
}
