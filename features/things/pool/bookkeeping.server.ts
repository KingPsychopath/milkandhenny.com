import { log } from "@/lib/platform/logger.server";

/** Game truth has already committed in Redis. Pool metadata is advisory, idempotent, and must not delay its acknowledgement. */
export async function settleGamePoolBookkeeping(operation: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observed = operation.then(
    () => undefined,
    (error) => {
      log.warn("game-pool.bookkeeping", "Advisory membership update failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    },
  );
  try {
    await Promise.race([
      observed,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 250);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
