import type { PlaceCandidate } from "@my-bookmark/ai";
import { describe, expect, it, vi } from "vitest";
import {
  createSupabasePlacesBackfillStore,
  type PlacesBackfillCandidate,
  type PlacesBackfillStore,
  parsePlacesBackfillArgs,
  runPlacesBackfill,
} from "../../scripts/backfill-places";
import type { PlaceGeocoder } from "../services/place-geocoder";

function candidate(id: string): PlacesBackfillCandidate {
  return {
    id,
    user_id: "user",
    kind: "link",
    url: `https://example.com/${id}`,
    title: `제목 ${id}`,
    description: null,
    site_name: null,
    image_original_path: null,
    metadata: null,
  };
}

function place(name: string, confidence = 0.9): PlaceCandidate {
  return { name, locality: "서촌", countryCode: "KR", confidence };
}

function createStore(overrides: Partial<PlacesBackfillStore> = {}) {
  const store: PlacesBackfillStore = {
    findCandidates: vi.fn().mockResolvedValue([candidate("a"), candidate("b")]),
    findPendingPlaces: vi
      .fn()
      .mockResolvedValue([
        { id: "p1", user_id: "user", name: "카페", locality: "서촌" },
      ]),
    savePlaces: vi.fn().mockResolvedValue(undefined),
    geocode: vi.fn().mockResolvedValue({ resolved: 1, notFound: 0, failed: 0 }),
    ...overrides,
  };
  return store;
}

const geocoder: PlaceGeocoder = { geocode: vi.fn() };

function createLogger() {
  return { info: vi.fn(), warn: vi.fn() };
}

describe("places backfill args", () => {
  it("parses flags and rejects bad input", () => {
    expect(parsePlacesBackfillArgs([])).toEqual({
      dryRun: false,
      geocodeOnly: false,
    });
    expect(
      parsePlacesBackfillArgs(["--dry-run", "--geocode-only", "--limit", "3"]),
    ).toEqual({ dryRun: true, geocodeOnly: true, limit: 3 });
    expect(() => parsePlacesBackfillArgs(["--limit", "0"])).toThrow(
      "positive integer",
    );
    expect(() => parsePlacesBackfillArgs(["--nope"])).toThrow("Unknown");
  });
});

describe("places backfill run", () => {
  it("does not analyze, save, or geocode in a dry run", async () => {
    const store = createStore();
    const analyze = vi.fn();
    const result = await runPlacesBackfill({
      store,
      analyze,
      geocoder,
      args: { dryRun: true, geocodeOnly: false },
      logger: createLogger(),
    });
    expect(result).toMatchObject({ candidates: 2, processed: 0 });
    expect(analyze).not.toHaveBeenCalled();
    expect(store.savePlaces).not.toHaveBeenCalled();
    expect(store.geocode).not.toHaveBeenCalled();
  });

  it("saves only confident, de-duplicated places and then geocodes pending ones", async () => {
    const store = createStore();
    const analyze = vi
      .fn()
      .mockResolvedValueOnce([
        place("서촌 커피"),
        place("서촌-커피"),
        place("아마도", 0.5),
      ])
      .mockResolvedValueOnce([]);
    const result = await runPlacesBackfill({
      store,
      analyze,
      geocoder,
      args: { dryRun: false, geocodeOnly: false },
      logger: createLogger(),
    });

    expect(store.savePlaces).toHaveBeenNthCalledWith(1, candidate("a"), [
      place("서촌 커피"),
    ]);
    expect(store.savePlaces).toHaveBeenNthCalledWith(2, candidate("b"), []);
    expect(store.geocode).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      dryRun: false,
      geocodeOnly: false,
      candidates: 2,
      processed: 2,
      places: 1,
      resolved: 1,
      failed: 0,
    });
  });

  it("isolates failures per bookmark and reports them", async () => {
    const store = createStore();
    const analyze = vi
      .fn()
      .mockRejectedValueOnce(new Error("ai down"))
      .mockResolvedValueOnce([place("서촌 커피")]);
    const logger = createLogger();
    const result = await runPlacesBackfill({
      store,
      analyze,
      geocoder,
      args: { dryRun: false, geocodeOnly: false },
      logger,
    });

    expect(result).toMatchObject({ processed: 1, failed: 1, places: 1 });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("bookmark a: ai down"),
    );
    expect(store.savePlaces).toHaveBeenCalledTimes(1);
  });

  it("keeps places pending without a geocoder", async () => {
    const store = createStore();
    const logger = createLogger();
    await runPlacesBackfill({
      store,
      analyze: vi.fn().mockResolvedValue([place("서촌 커피")]),
      geocoder: null,
      args: { dryRun: false, geocodeOnly: false },
      logger,
    });
    expect(store.geocode).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("stay pending"),
    );
  });

  it("geocode-only never analyzes and requires a geocoder", async () => {
    const store = createStore();
    const analyze = vi.fn();
    const result = await runPlacesBackfill({
      store,
      analyze,
      geocoder,
      args: { dryRun: false, geocodeOnly: true },
      logger: createLogger(),
    });
    expect(analyze).not.toHaveBeenCalled();
    expect(store.findCandidates).not.toHaveBeenCalled();
    expect(result).toMatchObject({ candidates: 1, resolved: 1 });

    await expect(
      runPlacesBackfill({
        store,
        analyze,
        geocoder: null,
        args: { dryRun: false, geocodeOnly: true },
        logger: createLogger(),
      }),
    ).rejects.toThrow("NAVER_SEARCH_CLIENT_ID");
  });
});

describe("places backfill store", () => {
  function createClient() {
    const calls = {
      deletes: 0,
      inserts: [] as unknown[],
      metadataUpdates: [] as unknown[],
    };
    const client = {
      storage: { from: vi.fn() },
      from(table: string) {
        if (table === "bookmark_places") {
          return {
            delete: () => ({
              eq: () => ({
                eq: () => {
                  calls.deletes += 1;
                  return Promise.resolve({ error: null });
                },
              }),
            }),
            insert: (rows: unknown[]) => {
              calls.inserts.push(rows);
              return Promise.resolve({ error: null });
            },
          };
        }
        return {
          update: (values: unknown) => ({
            eq: () => ({
              eq: () => {
                calls.metadataUpdates.push(values);
                return Promise.resolve({ error: null });
              },
            }),
          }),
        };
      },
    };
    return { client, calls };
  }

  const legacy = {
    예약메모: "창가",
    네이버지도: "https://map.naver.com/p/search/%EC%8B%9D%EB%8B%B9",
  };

  it("removes the auto-generated Naver link only when places were saved", async () => {
    const withPlaces = createClient();
    await createSupabasePlacesBackfillStore(withPlaces.client).savePlaces(
      { ...candidate("a"), metadata: legacy },
      [place("서촌 커피")],
    );
    expect(withPlaces.calls.inserts).toHaveLength(1);
    expect(withPlaces.calls.metadataUpdates).toEqual([
      { metadata: { 예약메모: "창가" } },
    ]);

    const withoutPlaces = createClient();
    await createSupabasePlacesBackfillStore(withoutPlaces.client).savePlaces(
      { ...candidate("a"), metadata: legacy },
      [],
    );
    expect(withoutPlaces.calls.metadataUpdates).toEqual([]);

    const custom = createClient();
    await createSupabasePlacesBackfillStore(custom.client).savePlaces(
      {
        ...candidate("a"),
        metadata: { 네이버지도: "https://naver.me/abcdef" },
      },
      [place("서촌 커피")],
    );
    expect(custom.calls.metadataUpdates).toEqual([]);
  });
});
