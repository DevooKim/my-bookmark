import { stageSharedImages } from "../lib/share-target";

const VERSION = "v1";
const ASSET_CACHE = `my-bookmark-assets-${VERSION}`;
const API_CACHE = `my-bookmark-api-${VERSION}`;
const CACHE_NAMES = [ASSET_CACHE, API_CACHE];

type CacheStrategy =
  | "asset-cache-first"
  | "asset-network-first"
  | "api-network-first"
  | "network-only";

type ExtendableEventLike = Event & {
  waitUntil: (promise: Promise<unknown>) => void;
};

type FetchEventLike = ExtendableEventLike & {
  request: Request;
  respondWith: (response: Promise<Response>) => void;
};

type MessageEventLike = {
  data?: unknown;
  waitUntil?: (promise: Promise<unknown>) => void;
};

type PushEventLike = ExtendableEventLike & {
  data?: {
    json: () => unknown;
  };
};

type NotificationClickEventLike = ExtendableEventLike & {
  notification: Notification & { data?: { url?: unknown } };
};

type WindowClientLike = unknown;

type ServiceWorkerScopeLike = typeof globalThis & {
  skipWaiting?: () => Promise<void>;
  clients?: {
    claim: () => Promise<void>;
    openWindow: (url: string) => Promise<WindowClientLike | null>;
  };
  registration?: {
    showNotification: (
      title: string,
      options?: NotificationOptions,
    ) => Promise<void>;
  };
  addEventListener?: (type: string, listener: (event: Event) => void) => void;
};

const swScope = globalThis as ServiceWorkerScopeLike;

export function classifyRequest(request: Request): CacheStrategy {
  if (request.method !== "GET") {
    return "network-only";
  }

  const url = new URL(request.url);

  // app-styles.css keeps one fixed URL across deploys (SSR/client hash
  // mismatch workaround) — cache-first would pin the old CSS forever.
  if (url.pathname === "/assets/app-styles.css") {
    return "asset-network-first";
  }

  if (url.pathname.startsWith("/assets/")) {
    return "asset-cache-first";
  }

  if (url.pathname === "/api/bookmarks" || url.pathname === "/api/categories") {
    return "api-network-first";
  }

  return "network-only";
}

export function shouldCacheResponse(response: Response): boolean {
  return (
    response.ok &&
    (response.type === "basic" ||
      response.type === "cors" ||
      response.type === "default")
  );
}

async function cacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (shouldCacheResponse(response)) {
    const cache = await caches.open(ASSET_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(
  request: Request,
  cacheName: string,
): Promise<Response> {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (shouldCacheResponse(response)) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw error;
  }
}

export async function clearApiCache(): Promise<boolean> {
  return caches.delete(API_CACHE);
}

export function handleMessage(event: MessageEventLike): void {
  const data = event.data;
  if (!data || typeof data !== "object") {
    return;
  }

  if ((data as { type?: unknown }).type === "CLEAR_API_CACHE") {
    const clearPromise = clearApiCache();
    event.waitUntil?.(clearPromise);
  }
}

export async function handleFetch(request: Request): Promise<Response> {
  if (isShareTargetRequest(request)) {
    return handleShareTarget(request);
  }
  switch (classifyRequest(request)) {
    case "asset-cache-first":
      return cacheFirst(request);
    case "asset-network-first":
      return networkFirst(request, ASSET_CACHE);
    case "api-network-first":
      return networkFirst(request, API_CACHE);
    case "network-only":
      return fetch(request);
  }
}

function isShareTargetRequest(request: Request): boolean {
  return (
    request.method === "POST" &&
    new URL(request.url).pathname === "/share-target"
  );
}

export async function handleShareTarget(
  request: Request,
  stage: (files: File[]) => Promise<string> = stageSharedImages,
): Promise<Response> {
  try {
    const form = await request.formData();
    const images = form
      .getAll("images")
      .filter(
        (value): value is File =>
          typeof value !== "string" && value.type.startsWith("image/"),
      );
    const id = await stage(images);
    const redirect = new URL("/share-target", request.url);
    redirect.searchParams.set("id", id);
    return Response.redirect(redirect, 303);
  } catch {
    return new Response("공유된 이미지를 처리하지 못했어요", { status: 400 });
  }
}

function parsePushPayload(data: PushEventLike["data"]): {
  title?: string;
  body?: string;
  url?: string;
} {
  if (!data) {
    return {};
  }

  try {
    const parsed = data.json();
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const payload = parsed as {
      title?: unknown;
      body?: unknown;
      url?: unknown;
    };
    const result: { title?: string; body?: string; url?: string } = {};
    if (typeof payload.title === "string") {
      result.title = payload.title;
    }
    if (typeof payload.body === "string") {
      result.body = payload.body;
    }
    if (typeof payload.url === "string") {
      result.url = payload.url;
    }
    return result;
  } catch {
    return {};
  }
}

swScope.addEventListener?.("install", (event) => {
  (event as ExtendableEventLike).waitUntil(
    swScope.skipWaiting?.() ?? Promise.resolve(),
  );
});

swScope.addEventListener?.("activate", (event) => {
  (event as ExtendableEventLike).waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) =>
              name.startsWith("my-bookmark-") && !CACHE_NAMES.includes(name),
          )
          .map((name) => caches.delete(name)),
      );
      await swScope.clients?.claim();
    })(),
  );
});

swScope.addEventListener?.("fetch", (event) => {
  const fetchEvent = event as FetchEventLike;
  fetchEvent.respondWith(handleFetch(fetchEvent.request));
});

swScope.addEventListener?.("message", (event) => {
  handleMessage(event as MessageEventLike);
});

swScope.addEventListener?.("push", (event) => {
  const pushEvent = event as PushEventLike;
  const data = parsePushPayload(pushEvent.data);
  const options: NotificationOptions = {
    badge: "/icons/badge.png",
    data: { url: data.url },
    icon: "/icons/icon-192.png",
  };
  if (data.body) {
    options.body = data.body;
  }

  pushEvent.waitUntil(
    swScope.registration?.showNotification(
      data.title ?? "북마크 리마인더",
      options,
    ) ?? Promise.resolve(),
  );
});

swScope.addEventListener?.("notificationclick", (event) => {
  const clickEvent = event as NotificationClickEventLike;
  clickEvent.notification.close();
  const url = clickEvent.notification.data?.url;
  if (typeof url === "string" && url.length > 0) {
    clickEvent.waitUntil(
      swScope.clients?.openWindow(url) ?? Promise.resolve(null),
    );
  }
});
