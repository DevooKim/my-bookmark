type ServiceWorkerContainerLike = {
  register: (scriptURL: string) => Promise<unknown>;
};

type BrowserLike = {
  navigator: {
    serviceWorker?: ServiceWorkerContainerLike;
  };
  location: {
    protocol: string;
  };
};

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
    await browser.navigator.serviceWorker.register("/sw.js");
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}
