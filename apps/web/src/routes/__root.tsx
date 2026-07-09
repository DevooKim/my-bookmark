import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { registerServiceWorker } from "../lib/service-worker";
import appCss from "../styles.css?url";

// sonner stays out of the entry chunk; toasts only fire after interaction.
const Toaster = lazy(() =>
  import("sonner").then((module) => ({ default: module.Toaster })),
);

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#0a0a0a" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Bookmark" },
      { title: "My Bookmark" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icons/icon-192.png" },
    ],
  }),
  component: App,
  shellComponent: RootDocument,
});

function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000 } },
      }),
  );

  useEffect(() => {
    void registerServiceWorker();

    const stored = localStorage.getItem("theme");
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    document.documentElement.classList.toggle(
      "dark",
      stored === "dark" || (!stored && prefersDark),
    );
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Suspense fallback={null}>
        <Toaster richColors position="top-center" />
      </Suspense>
    </QueryClientProvider>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
