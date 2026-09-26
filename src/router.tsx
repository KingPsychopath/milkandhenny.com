import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { routeTree } from "./routeTree.gen";
import { createAppQueryClient } from "./query-client";

export function getRouter() {
  // Pitch Night prepares full-document restoration before hydration. Skipping the
  // router's first reset prevents it from seizing the first user scroll later.
  let isInitialRender = true;
  const queryClient = createAppQueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: ({ location }) => {
      const shouldRestore =
        !isInitialRender || location.pathname !== "/pitch-night" || Boolean(location.hash);
      isInitialRender = false;
      return shouldRestore;
    },
    scrollRestorationBehavior: "instant",
    defaultPreload: "intent",
    // Router-owned loaders still use their settled preloads during migration.
    // Query-backed routes opt into preloadStaleTime: 0 so Query owns freshness.
    defaultPreloadStaleTime: 30_000,
    // Route loaders may depend on identity, cookies, or mutable product state. Public routes that
    // can safely stay fresh longer opt in locally; the safe default is to revalidate on reuse.
    defaultStaleTime: 0,
  });

  setupRouterSsrQueryIntegration({ router, queryClient });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
