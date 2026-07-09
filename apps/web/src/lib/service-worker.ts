const API_CACHE_NAME = "my-bookmark-api-v1";

type ServiceWorkerControllerLike = {
  postMessage: (message: unknown) => void;
};

type ServiceWorkerContainerLike = {
  controller?: ServiceWorkerControllerLike | null;
  register: (scriptURL: string) => Promise<unknown>;
};

type CacheStorageLike = {
  delete: (cacheName: string) => Promise<boolean>;
};

type BrowserLike = {
  caches?: CacheStorageLike;
  navigator: {
    serviceWorker?: Partial<ServiceWorkerContainerLike>;
  };
  location: {
    protocol: string;
  };
};

export async function clearServiceWorkerApiCache(
  browser: BrowserLike = window,
): Promise<void> {
  browser.navigator.serviceWorker?.controller?.postMessage({
    type: "CLEAR_API_CACHE",
  });

  await browser.caches?.delete(API_CACHE_NAME);
}

export async function registerServiceWorker(
  browser: BrowserLike = window,
): Promise<void> {
  if (!browser.navigator.serviceWorker) {
    return;
  }

  if (
    browser.location.protocol !== "https:" &&
    browser.location.protocol !== "http:"
  ) {
    return;
  }

  try {
    await browser.navigator.serviceWorker.register?.("/sw.js");
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}
