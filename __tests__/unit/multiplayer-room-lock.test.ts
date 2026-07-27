import { describe, expect, it, vi } from "vitest";
import {
  MultiplayerRoomBusyError,
  withMultiplayerRoomLock,
} from "../../features/things/shared/room-primitives.server";

/** Minimal stand-in for the single-key `SET NX PX` / release-script contract the lock relies on. */
function fakeRedis() {
  const keys = new Map<string, string>();
  return {
    keys,
    set: vi.fn(async (key: string, value: string, options: { nx: true; px: number }) => {
      if (options.nx && keys.has(key)) return null;
      keys.set(key, value);
      return "OK";
    }),
    eval: vi.fn(async (_script: string, [key]: string[], [owner]: string[]) => {
      if (keys.get(key) !== owner) return 0;
      keys.delete(key);
      return 1;
    }),
  };
}

const room = { roomId: "ABC2345", lockKey: "room:ABC2345:lock" };

describe("multiplayer room lock", () => {
  it("releases the lock so the next writer can take it", async () => {
    const redis = fakeRedis();
    await withMultiplayerRoomLock(redis, room, async () => "first");
    expect(redis.keys.has(room.lockKey)).toBe(false);
    await expect(withMultiplayerRoomLock(redis, room, async () => "second")).resolves.toBe(
      "second",
    );
  });

  it("serialises writers rather than letting them interleave", async () => {
    const redis = fakeRedis();
    const order: string[] = [];
    const hold = async (label: string) => {
      order.push(`${label}:enter`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(`${label}:exit`);
    };
    await Promise.all([
      withMultiplayerRoomLock(redis, room, () => hold("a")),
      withMultiplayerRoomLock(redis, room, () => hold("b")),
    ]);
    // Whoever went second must not have entered before the first one left.
    expect(order[1]).toBe(order[0].replace(":enter", ":exit"));
  });

  it("releases the lock when the guarded work throws", async () => {
    const redis = fakeRedis();
    await expect(
      withMultiplayerRoomLock(redis, room, async () => {
        throw new Error("write failed");
      }),
    ).rejects.toThrow("write failed");
    expect(redis.keys.has(room.lockKey)).toBe(false);
  });

  it("never deletes a lock that has already passed to another owner", async () => {
    const redis = fakeRedis();
    await withMultiplayerRoomLock(redis, room, async () => {
      // The lock expired mid-write and a second writer claimed it.
      redis.keys.set(room.lockKey, "someone-else");
    });
    expect(redis.keys.get(room.lockKey)).toBe("someone-else");
  });

  it("reports a busy room instead of writing without the lock", async () => {
    const redis = fakeRedis();
    redis.keys.set(room.lockKey, "holder");
    const attempts: boolean[] = [];
    const use = vi.fn(async () => "unreachable");
    await expect(
      withMultiplayerRoomLock(
        redis,
        { ...room, onAttempt: ({ acquired }) => attempts.push(acquired) },
        use,
      ),
    ).rejects.toBeInstanceOf(MultiplayerRoomBusyError);
    expect(use).not.toHaveBeenCalled();
    expect(attempts).toEqual([false]);
  });

  it("reports contention that resolved, for telemetry", async () => {
    const redis = fakeRedis();
    redis.keys.set(room.lockKey, "holder");
    setTimeout(() => redis.keys.delete(room.lockKey), 25);
    const attempts: Array<{ acquired: boolean; contended: boolean }> = [];
    await withMultiplayerRoomLock(
      redis,
      { ...room, onAttempt: ({ acquired, contended }) => attempts.push({ acquired, contended }) },
      async () => "done",
    );
    expect(attempts).toEqual([{ acquired: true, contended: true }]);
  });
});
