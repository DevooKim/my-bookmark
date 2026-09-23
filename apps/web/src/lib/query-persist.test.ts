import { QueryClient } from "@tanstack/react-query";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPersistedQueries,
  createThrottledPersister,
  type PersistStorage,
  shouldPersistQuery,
  startQueryPersistence,
  trimInfinitePages,
} from "./query-persist";

function memoryStorage(initial?: PersistedClient) {
  let value = initial;
  const storage: PersistStorage = {
    get: vi.fn(async () => value),
    set: vi.fn(async (client: PersistedClient) => {
      value = client;
    }),
    del: vi.fn(async () => {
      value = undefined;
    }),
  };
  return { storage, current: () => value };
}

function queryFor(queryClient: QueryClient, queryKey: unknown[]) {
  const query = queryClient.getQueryCache().find({ queryKey, exact: true });
  if (!query) {
    throw new Error("query not found");
  }
  return query;
}

function stateWith(data: unknown) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(["state"], data);
  return queryFor(queryClient, ["state"]).state;
}

afterEach(async () => {
  vi.useRealTimers();
  await clearPersistedQueries(memoryStorage().storage);
});

describe("shouldPersistQuery", () => {
  it("persists successful list queries but not searches or other keys", () => {
    const queryClient = new QueryClient();
    const keys = [
      ["bookmarks", { categoryId: undefined, kind: undefined, q: "" }],
      ["bookmarks", { categoryId: "c1", kind: "link", q: "" }],
      ["bookmarks", { q: "react" }],
      ["categories"],
      ["reminders"],
      ["bookmark", "id-1"],
      ["pushStatus"],
    ];
    for (const key of keys) {
      queryClient.setQueryData(key, { items: [] });
    }

    expect(
      keys.map((key) => shouldPersistQuery(queryFor(queryClient, key))),
    ).toEqual([true, true, false, true, true, false, false]);
  });

  it("skips queries that have not succeeded", () => {
    const queryClient = new QueryClient();
    queryClient
      .getQueryCache()
      .build(queryClient, { queryKey: ["categories"] });

    expect(shouldPersistQuery(queryFor(queryClient, ["categories"]))).toBe(
      false,
    );
  });
});

describe("trimInfinitePages", () => {
  it("keeps only the first page of infinite queries", () => {
    const client: PersistedClient = {
      buster: "b",
      timestamp: 1,
      clientState: {
        mutations: [],
        queries: [
          {
            queryHash: "bookmarks",
            queryKey: ["bookmarks", {}],
            state: stateWith({
              pages: ["p1", "p2", "p3"],
              pageParams: [null, "c1", "c2"],
            }),
          },
          {
            queryHash: "categories",
            queryKey: ["categories"],
            state: stateWith({ items: [1, 2] }),
          },
        ],
      },
    };

    const trimmed = trimInfinitePages(client);

    expect(trimmed.clientState.queries[0]?.state.data).toEqual({
      pages: ["p1"],
      pageParams: [null],
    });
    expect(trimmed.clientState.queries[1]?.state.data).toEqual({
      items: [1, 2],
    });
  });
});

describe("createThrottledPersister", () => {
  it("coalesces rapid saves into one write of the latest snapshot", async () => {
    vi.useFakeTimers();
    const { storage } = memoryStorage();
    const persister = createThrottledPersister(storage, 1000);
    const snapshot = (timestamp: number): PersistedClient => ({
      buster: "b",
      timestamp,
      clientState: { mutations: [], queries: [] },
    });

    await persister.persistClient(snapshot(1));
    await persister.persistClient(snapshot(2));
    await persister.persistClient(snapshot(3));
    expect(storage.set).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);

    expect(storage.set).toHaveBeenCalledOnce();
    expect(storage.set).toHaveBeenCalledWith(snapshot(3));
  });

  it("drops a pending write when the client is removed", async () => {
    vi.useFakeTimers();
    const { storage } = memoryStorage();
    const persister = createThrottledPersister(storage, 1000);

    await persister.persistClient({
      buster: "b",
      timestamp: 1,
      clientState: { mutations: [], queries: [] },
    });
    await persister.removeClient();
    await vi.advanceTimersByTimeAsync(1000);

    expect(storage.set).not.toHaveBeenCalled();
    expect(storage.del).toHaveBeenCalledOnce();
  });
});

describe("startQueryPersistence", () => {
  it("restores the last snapshot and saves later changes", async () => {
    const source = new QueryClient();
    source.setQueryData(["categories"], { items: [{ id: "c1" }] });
    const { storage, current } = memoryStorage({
      buster: "build-1",
      timestamp: Date.now(),
      clientState: {
        mutations: [],
        queries: source
          .getQueryCache()
          .getAll()
          .map((query) => ({
            queryHash: query.queryHash,
            queryKey: query.queryKey,
            state: query.state,
          })),
      },
    });
    const queryClient = new QueryClient();

    await startQueryPersistence(queryClient, { buster: "build-1", storage });

    expect(queryClient.getQueryData(["categories"])).toEqual({
      items: [{ id: "c1" }],
    });

    vi.useFakeTimers();
    queryClient.setQueryData(["reminders"], { items: [] });
    await vi.advanceTimersByTimeAsync(1000);

    expect(
      current()?.clientState.queries.map((query) => query.queryKey),
    ).toEqual([["categories"], ["reminders"]]);
  });

  it("discards a snapshot written by another build", async () => {
    const { storage, current } = memoryStorage({
      buster: "build-old",
      timestamp: Date.now(),
      clientState: {
        mutations: [],
        queries: [
          {
            queryHash: '["categories"]',
            queryKey: ["categories"],
            state: stateWith({ items: [] }),
          },
        ],
      },
    });
    const queryClient = new QueryClient();

    await startQueryPersistence(queryClient, { buster: "build-new", storage });

    expect(queryClient.getQueryData(["categories"])).toBeUndefined();
    expect(current()).toBeUndefined();
  });

  it("stops saving and deletes the snapshot on clear", async () => {
    const { storage, current } = memoryStorage();
    const queryClient = new QueryClient();
    await startQueryPersistence(queryClient, { buster: "b", storage });

    vi.useFakeTimers();
    await clearPersistedQueries(storage);
    queryClient.setQueryData(["categories"], { items: [] });
    await vi.advanceTimersByTimeAsync(1000);

    expect(current()).toBeUndefined();
    expect(storage.del).toHaveBeenCalled();
  });
});
