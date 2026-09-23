import {
  defaultShouldDehydrateQuery,
  type Query,
  type QueryClient,
} from "@tanstack/react-query";
import {
  type PersistedClient,
  type Persister,
  persistQueryClientRestore,
  persistQueryClientSubscribe,
} from "@tanstack/react-query-persist-client";
import { createStore, del, get, set } from "idb-keyval";

const PERSISTED_ROOT_KEYS = ["bookmarks", "categories", "reminders"];
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SAVE_THROTTLE_MS = 1000;
const CLIENT_KEY = "query-client";

export type PersistStorage = {
  get: () => Promise<PersistedClient | undefined>;
  set: (client: PersistedClient) => Promise<void>;
  del: () => Promise<void>;
};

export function createIdbStorage(): PersistStorage {
  const store = createStore("my-bookmark", "query-cache");
  return {
    get: () => get<PersistedClient>(CLIENT_KEY, store),
    set: (client) => set(CLIENT_KEY, client, store),
    del: () => del(CLIENT_KEY, store),
  };
}

export function shouldPersistQuery(query: Query): boolean {
  if (!defaultShouldDehydrateQuery(query)) {
    return false;
  }
  const [root, filters] = query.queryKey;
  if (typeof root !== "string" || !PERSISTED_ROOT_KEYS.includes(root)) {
    return false;
  }
  // Search results are transient; persisting every debounced keystroke
  // would bloat the store without making cold start faster.
  if (root === "bookmarks") {
    return !(
      typeof filters === "object" &&
      filters !== null &&
      "q" in filters &&
      filters.q
    );
  }
  return true;
}

type InfiniteDataLike = { pages: unknown[]; pageParams: unknown[] };

function isInfiniteData(value: unknown): value is InfiniteDataLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "pages" in value &&
    "pageParams" in value &&
    Array.isArray(value.pages) &&
    Array.isArray(value.pageParams)
  );
}

// An infinite query refetches every loaded page in sequence, so a restored
// 30-page list would fire 30 requests on startup. Keep only the first page.
export function trimInfinitePages(client: PersistedClient): PersistedClient {
  return {
    ...client,
    clientState: {
      ...client.clientState,
      queries: client.clientState.queries.map((query) => {
        const data = query.state.data;
        if (!isInfiniteData(data) || data.pages.length <= 1) {
          return query;
        }
        return {
          ...query,
          state: {
            ...query.state,
            data: {
              pages: data.pages.slice(0, 1),
              pageParams: data.pageParams.slice(0, 1),
            },
          },
        };
      }),
    },
  };
}

// persistQueryClientSubscribe saves on every cache event (including fetch
// status changes), so coalesce writes into one per throttle window.
export function createThrottledPersister(
  storage: PersistStorage,
  throttleMs = SAVE_THROTTLE_MS,
): Persister {
  let pending: PersistedClient | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    persistClient(client) {
      pending = client;
      if (timer) {
        return;
      }
      timer = setTimeout(() => {
        timer = undefined;
        const latest = pending;
        pending = undefined;
        if (latest) {
          void storage.set(trimInfinitePages(latest)).catch(() => undefined);
        }
      }, throttleMs);
    },
    restoreClient: () => storage.get(),
    async removeClient() {
      clearTimeout(timer);
      timer = undefined;
      pending = undefined;
      await storage.del();
    },
  };
}

type PersistenceSession = {
  persister: Persister;
  restored: Promise<void>;
  unsubscribe: () => void;
};

let session: PersistenceSession | undefined;

export function startQueryPersistence(
  queryClient: QueryClient,
  {
    buster,
    storage = createIdbStorage(),
  }: { buster: string; storage?: PersistStorage },
): Promise<void> {
  if (session) {
    return session.restored;
  }

  for (const root of PERSISTED_ROOT_KEYS) {
    // Inactive queries must outlive a session so they are still in the
    // snapshot the next time the app opens.
    queryClient.setQueryDefaults([root], { gcTime: MAX_AGE_MS });
  }

  const persister = createThrottledPersister(storage);
  const current: PersistenceSession = {
    persister,
    restored: Promise.resolve(),
    unsubscribe: () => undefined,
  };
  session = current;

  current.restored = persistQueryClientRestore({
    queryClient,
    persister,
    buster,
    maxAge: MAX_AGE_MS,
  })
    // A corrupt or unreadable store only costs the instant first paint.
    .catch(() => undefined)
    .then(() => {
      if (session !== current) {
        return;
      }
      current.unsubscribe = persistQueryClientSubscribe({
        queryClient,
        persister,
        buster,
        dehydrateOptions: {
          shouldDehydrateQuery: shouldPersistQuery,
          shouldDehydrateMutation: () => false,
        },
      });
    });

  return current.restored;
}

export async function clearPersistedQueries(
  storage: PersistStorage = createIdbStorage(),
): Promise<void> {
  const current = session;
  session = undefined;
  if (current) {
    current.unsubscribe();
    await current.persister.removeClient();
    return;
  }
  await storage.del();
}
