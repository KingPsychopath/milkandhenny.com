import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/logger.server", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { eventsOperation } from "@/features/events/events-operation.server";
import { runEffectResult } from "@/lib/platform/effect-boundary.server";

describe("Effect operation behavior", () => {
  it("classifies a transient read as retryable and preserves its cause", async () => {
    const cause = Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
    const error = await Effect.runPromise(
      Effect.flip(
        eventsOperation({ domain: "events", operation: "read", kind: "read" }, () =>
          Promise.reject(cause),
        ),
      ),
    );
    expect(error).toMatchObject({
      classification: "transient",
      cause,
      outcome: "known",
      retryable: true,
    });
  });

  it("classifies a timed mutation as uncertain and non-retryable", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        eventsOperation(
          { domain: "events", operation: "write", kind: "mutation", timeoutMs: 5 },
          (signal) =>
            new Promise((_resolve, reject) => {
              signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            }),
        ),
      ),
    );
    expect(error).toMatchObject({
      classification: "timeout",
      outcome: "uncertain",
      retryable: false,
    });
  });

  it("classifies a transient mutation as uncertain without inviting a duplicate", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        eventsOperation({ domain: "events", operation: "write", kind: "mutation" }, () =>
          Promise.reject(Object.assign(new Error("connection reset"), { code: "ECONNRESET" })),
        ),
      ),
    );
    expect(error).toMatchObject({
      classification: "transient",
      outcome: "uncertain",
      retryable: false,
    });
  });

  it("propagates a caller abort to the underlying promise", async () => {
    const controller = new AbortController();
    let operationSignal: AbortSignal | undefined;
    const running = Effect.runPromise(
      eventsOperation({ domain: "events", operation: "read", kind: "read" }, (signal) => {
        operationSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }),
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(operationSignal).toBeDefined());
    controller.abort();
    await expect(running).rejects.toBeDefined();
    expect(operationSignal?.aborted).toBe(true);
  });

  it("reports an interrupted mutation as uncertain at the transport edge", async () => {
    const controller = new AbortController();
    let operationSignal: AbortSignal | undefined;
    const running = runEffectResult(() =>
      Effect.runPromise(
        eventsOperation({ domain: "events", operation: "write", kind: "mutation" }, (signal) => {
          operationSignal = signal;
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        }),
        { signal: controller.signal },
      ),
    );

    await vi.waitFor(() => expect(operationSignal).toBeDefined());
    controller.abort();
    await expect(running).resolves.toMatchObject({
      ok: false,
      classification: "interruption",
      outcome: "uncertain",
      retryable: false,
    });
  });
});
