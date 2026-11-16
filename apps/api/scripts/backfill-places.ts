import "./admin/lib/load-env";
import { fileURLToPath } from "node:url";
import type { AiProvider, PlaceCandidate } from "@my-bookmark/ai";
import { z } from "zod";
import { createSupabaseAdminClient } from "./admin/lib/supabase";
import { domainFromUrl } from "./admin/lib/url";
import { getAiProvider } from "./admin/services/ai-provider";
import {
  type GeocodeRow,
  geocodePlaceRows,
  replaceBookmarkPlaces,
  selectPlaceCandidates,
} from "./admin/services/bookmark-places";
import { processImage } from "./admin/services/image-processing";
import {
  type ImageStorageBucket,
  loadImageForAnalysis,
} from "./admin/services/image-storage";
import { fetchMetadata } from "./admin/services/metadata";
import type { PlaceGeocoder } from "./admin/services/place-geocoder";
import { getPlaceGeocoder } from "./admin/services/place-geocoder-provider";

const QUERY_PAGE_SIZE = 500;
const IMAGE_BUCKET = "bookmark-images";
const LEGACY_NAVER_MAP_KEY = "네이버지도";
const LEGACY_NAVER_MAP_URL_PREFIX = "https://map.naver.com/p/search/";

const candidateSchema = z.object({
  id: z.string().min(1),
  user_id: z.string().min(1),
  kind: z.enum(["link", "image"]),
  url: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  site_name: z.string().nullable(),
  image_original_path: z.string().nullable(),
  metadata: z.record(z.string(), z.string()).nullable(),
});

export type PlacesBackfillCandidate = z.infer<typeof candidateSchema>;

const pendingPlaceSchema = z.object({
  id: z.string().min(1),
  user_id: z.string().min(1),
  name: z.string(),
  locality: z.string().nullable(),
});

export interface PlacesBackfillStore {
  // ai_status='done'이고 places_analyzed_at이 null인 북마크(장소가 0개여도 분석했다면 제외).
  findCandidates(limit?: number): Promise<PlacesBackfillCandidate[]>;
  // 좌표 조회를 기다리는(pending) 국내 장소.
  findPendingPlaces(limit?: number): Promise<GeocodeRow[]>;
  // 장소 행을 교체하고 places_analyzed_at을 기록한다(장소 0개 포함). 장소가 1개 이상일 때만
  // 과거 자동 생성 네이버지도 키를 지운다. 저장이 실패하면 기록하지 않아 다음 실행에서 재시도된다.
  savePlaces(
    candidate: PlacesBackfillCandidate,
    places: PlaceCandidate[],
  ): Promise<void>;
  geocode(rows: GeocodeRow[], geocoder: PlaceGeocoder): Promise<GeocodeTally>;
}

export interface GeocodeTally {
  resolved: number;
  notFound: number;
  failed: number;
}

export interface BackfillLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface PlacesBackfillArgs {
  dryRun: boolean;
  geocodeOnly: boolean;
  limit?: number;
}

export interface PlacesBackfillResult {
  dryRun: boolean;
  geocodeOnly: boolean;
  candidates: number;
  processed: number;
  places: number;
  resolved: number;
  failed: number;
}

export function isBackfillEntrypoint(
  moduleUrl: string,
  argvPath: string | undefined,
): boolean {
  return argvPath !== undefined && fileURLToPath(moduleUrl) === argvPath;
}

export function parsePlacesBackfillArgs(argv: string[]): PlacesBackfillArgs {
  let dryRun = false;
  let geocodeOnly = false;
  let limit: number | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--geocode-only") {
      geocodeOnly = true;
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

  return {
    dryRun,
    geocodeOnly,
    ...(limit === undefined ? {} : { limit }),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runPlacesBackfill(input: {
  store: PlacesBackfillStore;
  analyze: (candidate: PlacesBackfillCandidate) => Promise<PlaceCandidate[]>;
  geocoder: PlaceGeocoder | null;
  args: PlacesBackfillArgs;
  logger: BackfillLogger;
}): Promise<PlacesBackfillResult> {
  const { store, args, logger } = input;
  const result: PlacesBackfillResult = {
    dryRun: args.dryRun,
    geocodeOnly: args.geocodeOnly,
    candidates: 0,
    processed: 0,
    places: 0,
    resolved: 0,
    failed: 0,
  };

  if (args.geocodeOnly) {
    const rows = await store.findPendingPlaces(args.limit);
    result.candidates = rows.length;
    if (args.dryRun) {
      logger.info(
        `Places backfill dry run: ${rows.length} pending place(s) would be geocoded`,
      );
      return result;
    }
    if (!input.geocoder) {
      throw new Error(
        "NAVER_SEARCH_CLIENT_ID and NAVER_SEARCH_CLIENT_SECRET are required for --geocode-only",
      );
    }
    const tally = await store.geocode(rows, input.geocoder);
    result.resolved = tally.resolved;
    result.failed = tally.failed;
    logger.info(
      `Places backfill summary (geocode-only): pending=${rows.length}, resolved=${tally.resolved}, not_found=${tally.notFound}, failed=${tally.failed}`,
    );
    return result;
  }

  const candidates = await store.findCandidates(args.limit);
  result.candidates = candidates.length;
  if (args.dryRun) {
    logger.info(
      `Places backfill dry run: ${candidates.length} bookmark(s) would be analyzed`,
    );
    return result;
  }

  for (const candidate of candidates) {
    try {
      const places = selectPlaceCandidates(await input.analyze(candidate));
      await store.savePlaces(candidate, places);
      result.processed += 1;
      result.places += places.length;
    } catch (error) {
      result.failed += 1;
      logger.warn(
        `Places backfill failed for bookmark ${candidate.id}: ${errorMessage(error)}`,
      );
    }
  }

  // 저장된 pending 장소의 좌표를 이어서 조회한다. 키가 없으면 pending으로 남는다.
  if (input.geocoder) {
    const pending = await store.findPendingPlaces();
    const tally = await store.geocode(pending, input.geocoder);
    result.resolved = tally.resolved;
    result.failed += tally.failed;
  } else {
    logger.warn(
      "Naver search keys are not set; saved places stay pending (run --geocode-only later)",
    );
  }

  logger.info(
    `Places backfill summary: candidates=${result.candidates}, processed=${result.processed}, places=${result.places}, resolved=${result.resolved}, failed=${result.failed}`,
  );
  return result;
}

interface PagedQuery {
  range(
    from: number,
    to: number,
  ): PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>;
}

interface BackfillSupabaseClient {
  from(table: string): unknown;
  storage: { from(bucket: string): ImageStorageBucket };
}

async function readAllPages(
  makeQuery: () => PagedQuery,
  limit?: number,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += QUERY_PAGE_SIZE) {
    const { data, error } = await makeQuery().range(
      offset,
      offset + QUERY_PAGE_SIZE - 1,
    );
    if (error) {
      throw error;
    }
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (
      page.length < QUERY_PAGE_SIZE ||
      (limit !== undefined && rows.length >= limit)
    ) {
      return rows;
    }
  }
}

function withoutLegacyNaverMapKey(
  metadata: Record<string, string>,
): Record<string, string> {
  const { [LEGACY_NAVER_MAP_KEY]: _legacy, ...rest } = metadata;
  return rest;
}

export function createSupabasePlacesBackfillStore(
  supabase: BackfillSupabaseClient,
): PlacesBackfillStore {
  const table = (name: string) =>
    supabase.from(name) as {
      select(columns: string): {
        eq(
          column: string,
          value: string,
        ): PagedQuery & {
          is(
            column: string,
            value: null,
          ): {
            order(column: string, options: { ascending: boolean }): PagedQuery;
          };
          order(column: string, options: { ascending: boolean }): PagedQuery;
        };
        order(column: string, options: { ascending: boolean }): PagedQuery;
      } & PagedQuery;
    };

  return {
    async findCandidates(limit) {
      const bookmarkRows = await readAllPages(
        () =>
          table("bookmarks")
            .select(
              "id,user_id,kind,url,title,description,site_name,image_original_path,metadata",
            )
            .eq("ai_status", "done")
            .is("places_analyzed_at", null)
            .order("created_at", { ascending: false }),
        limit,
      );
      const candidates = candidateSchema.array().parse(bookmarkRows);
      return limit === undefined ? candidates : candidates.slice(0, limit);
    },
    async findPendingPlaces(limit) {
      const rows = await readAllPages(
        () =>
          table("bookmark_places")
            .select("id,user_id,name,locality")
            .eq("geocode_status", "pending")
            .order("created_at", { ascending: true }),
        limit,
      );
      const pending = pendingPlaceSchema.array().parse(rows);
      return limit === undefined ? pending : pending.slice(0, limit);
    },
    async savePlaces(candidate, places) {
      await replaceBookmarkPlaces(
        supabase,
        candidate.user_id,
        candidate.id,
        places,
      );
      const legacy = candidate.metadata?.[LEGACY_NAVER_MAP_KEY];
      const removeLegacy =
        places.length > 0 &&
        legacy?.startsWith(LEGACY_NAVER_MAP_URL_PREFIX) &&
        candidate.metadata;
      const values: Record<string, unknown> = {
        places_analyzed_at: new Date().toISOString(),
        ...(removeLegacy
          ? { metadata: withoutLegacyNaverMapKey(removeLegacy) }
          : {}),
      };
      const { error } = await (
        supabase.from("bookmarks") as {
          update(values: Record<string, unknown>): {
            eq(
              column: string,
              value: string,
            ): {
              eq(
                column: string,
                value: string,
              ): PromiseLike<{ error: { message?: string } | null }>;
            };
          };
        }
      )
        .update(values)
        .eq("user_id", candidate.user_id)
        .eq("id", candidate.id);
      if (error) {
        throw error;
      }
    },
    geocode(rows, geocoder) {
      return geocodePlaceRows(supabase, rows, geocoder);
    },
  };
}

export function createAnalyzer(deps: {
  provider: AiProvider;
  loadCategories(userId: string): Promise<{ id: string; name: string }[]>;
  metadataFetcher?: typeof fetchMetadata;
  loadImage(originalPath: string): Promise<{
    mimeType: "image/jpeg";
    base64: string;
  }>;
}): (candidate: PlacesBackfillCandidate) => Promise<PlaceCandidate[]> {
  const metadataFetcher = deps.metadataFetcher ?? fetchMetadata;
  return async (candidate) => {
    const existingCategories = await deps.loadCategories(candidate.user_id);
    if (candidate.kind === "image") {
      if (!candidate.image_original_path) {
        throw new Error("Image bookmark is missing its original path");
      }
      const outcome = await deps.provider.categorize({
        kind: "image",
        image: await deps.loadImage(candidate.image_original_path),
        existingCategories,
      });
      return outcome.analysis.places ?? [];
    }
    if (!candidate.url) {
      throw new Error("Link bookmark is missing its URL");
    }
    // 원문 제목·설명으로 분석한다. 저장된 제목은 AI 요약본이라 장소 이름이 빠졌을 수 있다.
    const page = await metadataFetcher(candidate.url);
    const title = page.title ?? candidate.title ?? domainFromUrl(candidate.url);
    const description = page.description ?? candidate.description;
    const siteName = page.siteName ?? candidate.site_name;
    const outcome = await deps.provider.categorize({
      kind: "link",
      url: candidate.url,
      title,
      ...(description ? { description } : {}),
      ...(siteName ? { siteName } : {}),
      existingCategories,
    });
    return outcome.analysis.places ?? [];
  };
}

async function main(): Promise<void> {
  const args = parsePlacesBackfillArgs(process.argv.slice(2));
  const supabase = createSupabaseAdminClient();
  const store = createSupabasePlacesBackfillStore(supabase);
  const geocoder = getPlaceGeocoder();

  let analyze: (
    candidate: PlacesBackfillCandidate,
  ) => Promise<PlaceCandidate[]> = async () => [];
  if (!args.geocodeOnly && !args.dryRun) {
    const provider = getAiProvider();
    if (!provider) {
      throw new Error("OPEN_ROUTER_API_KEY is required for places backfill");
    }
    const categoriesByUser = new Map<
      string,
      Promise<{ id: string; name: string }[]>
    >();
    const storage = supabase.storage.from(IMAGE_BUCKET);
    analyze = createAnalyzer({
      provider,
      loadCategories(userId) {
        let categories = categoriesByUser.get(userId);
        if (!categories) {
          categories = (async () => {
            const { data, error } = await supabase
              .from("categories")
              .select("id,name")
              .eq("user_id", userId);
            if (error) {
              throw error;
            }
            return data ?? [];
          })();
          categoriesByUser.set(userId, categories);
        }
        return categories;
      },
      loadImage: (originalPath) =>
        loadImageForAnalysis(storage, originalPath, processImage),
    });
  }

  const result = await runPlacesBackfill({
    store,
    analyze,
    geocoder,
    args,
    logger: console,
  });
  if (!args.dryRun && result.failed > 0) {
    process.exitCode = 1;
  }
}

if (isBackfillEntrypoint(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(`Places backfill aborted: ${errorMessage(error)}`);
    process.exitCode = 1;
  });
}
