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
    // Route loaders may depend on identity, cookies, or mutable product state. Public routes that
    // can safely stay fresh longer opt in locally; the safe default is to revalidate on reuse.
    defaultStaleTime: 0,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
