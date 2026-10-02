import { afterEach, describe, expect, it, vi } from "vitest";
import { exitRoom } from "@/features/things/shared/room-exit.client";

afterEach(() => vi.useRealTimers());

describe("room departure without a working connection", () => {
  it("exits immediately when the departure is rejected or throws", async () => {
    for (const notify of [
      () => Promise.reject(new Error("offline")),
      () => {
        throw new Error("offline");
      },
    ]) {
      const exit = vi.fn();
      await expect(exitRoom(notify, exit)).resolves.toBe(true);
      expect(exit).toHaveBeenCalledOnce();
    }
  });

  it("exits once after the deadline even if the server responds later", async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const notify = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const exit = vi.fn();
    const result = exitRoom(notify, exit);
    await vi.advanceTimersByTimeAsync(1499);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe(true);
    expect(exit).toHaveBeenCalledOnce();
    finish?.();
    await Promise.resolve();
    expect(exit).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not delay a recorded departure", async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    await exitRoom(() => Promise.resolve(), exit);
    expect(exit).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
