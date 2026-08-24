import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  // Pitch Night prepares full-document restoration before hydration. Skipping the
  // router's first reset prevents it from seizing the first user scroll later.
  let isInitialRender = true;

  return createRouter({
    routeTree,
    scrollRestoration: ({ location }) => {
      const shouldRestore =
        !isInitialRender || location.pathname !== "/pitch-night" || Boolean(location.hash);
      isInitialRender = false;
      return shouldRestore;
    },
    scrollRestorationBehavior: "instant",
    defaultPreload: "intent",
    defaultPreloadStaleTime: 30_000,
    // Keep recently visited pages usable during back-and-forth navigation while
    // leaving server mutations and explicit invalidation responsible for freshness.
    defaultStaleTime: 10_000,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
