import type { getRouter } from "@/src/router";

/** Discard browser snapshots from the previous identity before resolving new routes. */
export async function resetAuthenticatedData(router: ReturnType<typeof getRouter>) {
  const queryClient = router.options.context.queryClient;
  await queryClient.cancelQueries();
  queryClient.clear();
  router.clearCache();
  await router.invalidate();
}
