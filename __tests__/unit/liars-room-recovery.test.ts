import { afterEach, describe, expect, it, vi } from "vitest";

import { forgetLiarsRoomRecovery } from "@/features/things/liars/LiarsRoomApp";
import { liarsBrowserKeys } from "@/features/things/liars/liars-keys";

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

describe("liars room recovery cleanup", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("clears player, creator, and invite recovery when someone explicitly leaves", () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
    const roomId = "ROOM234";
    storage.setItem(liarsBrowserKeys.playerSession(roomId), "player");
    storage.setItem(liarsBrowserKeys.hostSession(roomId), "host");
    storage.setItem(liarsBrowserKeys.invite(roomId), "invite");

    forgetLiarsRoomRecovery(roomId);

    expect(storage.length).toBe(0);
  });
});
