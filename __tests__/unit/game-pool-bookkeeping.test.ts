import { afterEach, expect, it, vi } from "vitest";
import { settleGamePoolBookkeeping } from "@/features/things/pool/bookkeeping.server";
vi.mock("@/lib/platform/logger.server", () => ({ log: { warn: vi.fn() } }));
afterEach(() => vi.useRealTimers());
it("acknowledges committed game work while slow advisory metadata is still pending", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const result = settleGamePoolBookkeeping(pending);
  await vi.advanceTimersByTimeAsync(250);
  await expect(result).resolves.toBeUndefined();
  release();
});
it("observes delayed failures after the response budget", async () => {
  vi.useFakeTimers();
  let reject!: (error: Error) => void;
  const result = settleGamePoolBookkeeping(
    new Promise<void>((_, fail) => {
      reject = fail;
    }),
  );
  await vi.advanceTimersByTimeAsync(250);
  await result;
  reject(new Error("database unavailable"));
  await Promise.resolve();
});
