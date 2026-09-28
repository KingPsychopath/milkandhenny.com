import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { resetAuthenticatedData } from "@/lib/client/reset-authenticated-data";
import type { getRouter } from "@/src/router";

describe("identity cache reset", () => {
  it("cancels an old read and removes private snapshots before reloading routes", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["account", "previous-viewer"], { email: "old@example.test" });
    let wasAborted = false;
    const pending = queryClient.fetchQuery({
      queryKey: ["tickets", "previous-viewer"],
      queryFn: ({ signal }) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            wasAborted = true;
            reject(new Error("cancelled"));
          });
        }),
    });
    const clearCache = vi.fn();
    const invalidate = vi.fn(async () => {
      expect(queryClient.getQueryData(["account", "previous-viewer"])).toBeUndefined();
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    });
    const router = {
      options: { context: { queryClient } },
      clearCache,
      invalidate,
    } as unknown as ReturnType<typeof getRouter>;

    await resetAuthenticatedData(router);
    await expect(pending).rejects.toThrow();
    expect(wasAborted).toBe(true);
    expect(clearCache).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledOnce();
  });
});
