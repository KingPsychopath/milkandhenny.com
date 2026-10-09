import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { releaseGamePoolAssignmentFn } = vi.hoisted(() => ({
  releaseGamePoolAssignmentFn: vi.fn(),
}));

vi.mock("@/features/things/pool/pool.functions", () => ({ releaseGamePoolAssignmentFn }));

import {
  gamePoolActiveMembershipKey,
  gamePoolMembershipKey,
  leaveGamePoolRoom,
  readActiveGamePoolMembership,
} from "@/features/things/pool/pool-session.client";
import { writeExpiringLocalValue } from "@/features/things/shared/game-storage.client";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("game pool room exit recovery", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", new MemoryStorage());
    releaseGamePoolAssignmentFn.mockReset();
    const expiresAt = Date.now() + 60_000;
    const membership = { token: "pool-token", clientId: "client-123456" };
    writeExpiringLocalValue(
      gamePoolMembershipKey("hot-and-cold", "ROOM123"),
      membership,
      expiresAt,
    );
    writeExpiringLocalValue(
      gamePoolActiveMembershipKey("hot-and-cold"),
      { ...membership, roomId: "ROOM123" },
      expiresAt,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("clears local recovery and returns to the pool chooser after a successful release", async () => {
    releaseGamePoolAssignmentFn.mockResolvedValue({ ok: true });

    await expect(leaveGamePoolRoom("hot-and-cold", "ROOM123")).resolves.toBe("/play/pool-token");
    expect(localStorage.getItem(gamePoolMembershipKey("hot-and-cold", "ROOM123"))).toBeNull();
    expect(localStorage.getItem(gamePoolActiveMembershipKey("hot-and-cold"))).toBeNull();
  });

  it("still clears stale recovery when the pool cannot be reached", async () => {
    releaseGamePoolAssignmentFn.mockRejectedValue(new Error("offline"));

    await expect(leaveGamePoolRoom("hot-and-cold", "ROOM123")).resolves.toBe("/play/pool-token");
    expect(localStorage.getItem(gamePoolMembershipKey("hot-and-cold", "ROOM123"))).toBeNull();
    expect(localStorage.getItem(gamePoolActiveMembershipKey("hot-and-cold"))).toBeNull();
  });

  it("abandons an unanswered release and clears recovery before waiting", async () => {
    vi.useFakeTimers();
    releaseGamePoolAssignmentFn.mockReturnValue(new Promise(() => {}));
    const left = leaveGamePoolRoom("hot-and-cold", "ROOM123");
    expect(readActiveGamePoolMembership("hot-and-cold")).toBeNull();
    await vi.advanceTimersByTimeAsync(1500);
    await expect(left).resolves.toBe("/play/pool-token");
    expect(releaseGamePoolAssignmentFn.mock.calls[0][0].signal.aborted).toBe(true);
  });

  it("does not prevent navigation when storage is blocked", async () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("blocked");
      },
      get length() {
        throw new Error("blocked");
      },
    });
    expect(readActiveGamePoolMembership("hot-and-cold")).toBeNull();
    await expect(leaveGamePoolRoom("hot-and-cold", "ROOM123")).resolves.toBeNull();
  });
});
