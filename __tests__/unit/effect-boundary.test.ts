import { Data, Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  classifyFailure,
  retryableFor,
  runEffectResult,
  transportFailure,
} from "@/lib/platform/effect-boundary.server";
import { createRuntimeLifecycle } from "@/lib/platform/runtime-lifecycle.server";
import { makeManagedRuntimeHost } from "@/lib/platform/managed-runtime.server";

class TaggedFailure extends Data.TaggedError("TaggedFailure")<{ readonly detail: string }> {}

describe("Effect service boundaries", () => {
  it("preserves a tagged failure through ManagedRuntime.runPromise", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const failure = new TaggedFailure({ detail: "kept" });
    await expect(runtime.runPromise(Effect.fail(failure))).rejects.toBe(failure);
    await runtime.dispose();
  });

  it("classifies timeout, interruption, and transient infrastructure failures", () => {
    expect(classifyFailure({ _tag: "TimeoutException" })).toBe("timeout");
    expect(classifyFailure(new DOMException("cancelled", "AbortError"))).toBe("interruption");
    expect(classifyFailure(Object.assign(new Error("socket"), { code: "ECONNRESET" }))).toBe(
      "transient",
    );
  });

  it("does not invite retrying an uncertain mutation", () => {
    expect(retryableFor("timeout", "mutation")).toBe(false);
    expect(retryableFor("timeout", "idempotent-mutation")).toBe(true);
    expect(
      transportFailure({
        classification: "timeout",
        outcome: "uncertain",
        retryable: false,
      }),
    ).toMatchObject({ status: 504, retryable: false, outcome: "uncertain" });
  });

  it("maps a typed failure once at the Promise transport edge", async () => {
    const result = await runEffectResult(() =>
      Promise.reject({
        classification: "domain",
        outcome: "known",
        publicMessage: "Nope",
        retryable: false,
        status: 409,
      }),
    );
    expect(result).toEqual({
      ok: false,
      classification: "domain",
      outcome: "known",
      error: "Nope",
      retryable: false,
      status: 409,
    });
  });

  it("rejects calls during and after one idempotent shutdown", async () => {
    let release!: () => void;
    const dispose = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const lifecycle = createRuntimeLifecycle(dispose, "Test");
    await expect(lifecycle.run(async () => 1)).resolves.toBe(1);
    const closing = lifecycle.dispose();
    await expect(lifecycle.run(async () => 2)).rejects.toThrow("disposing");
    release();
    await closing;
    await expect(lifecycle.run(async () => 3)).rejects.toThrow("disposed");
    await lifecycle.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("builds and releases a subsystem layer exactly once", async () => {
    const release = vi.fn();
    const host = makeManagedRuntimeHost(
      Layer.effectDiscard(Effect.acquireRelease(Effect.void, () => Effect.sync(release))),
      "Test host",
    );

    await expect(host.run(Effect.succeed(1))).resolves.toBe(1);
    await host.dispose();
    await host.dispose();

    expect(release).toHaveBeenCalledOnce();
    await expect(host.run(Effect.succeed(2))).rejects.toThrow("disposed");
  });
});
