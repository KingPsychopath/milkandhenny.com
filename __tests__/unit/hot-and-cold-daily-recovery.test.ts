import { describe, expect, it } from "vitest";
import { recoverDailyHotAndColdState } from "@/features/things/hot-and-cold/hot-and-cold-daily-recovery";
import { hotAndColdBrowserKeys } from "@/features/things/hot-and-cold/hot-and-cold-keys";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();

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

function state(input: {
  puzzle?: number;
  judgingVersion?: string;
  target?: string | null;
  words?: string[];
}) {
  return JSON.stringify({
    puzzle: input.puzzle ?? 5,
    judgingVersion: input.judgingVersion,
    target: input.target ?? null,
    gaveUp: false,
    hintsUsed: 0,
    runId: "0198e9d8-53d7-7db1-8da4-c0f557db73a1",
    resultRecorded: true,
    guesses: (input.words ?? []).map((word, index) => ({
      word,
      rank: 100 - index,
      band: "hot",
      sequence: index + 1,
      createdAt: index + 1,
    })),
  });
}

describe("Hot & Cold daily revision recovery", () => {
  it("finds the most complete save across arbitrary judging revisions", () => {
    const storage = new MemoryStorage();
    storage.setItem(hotAndColdBrowserKeys.daily(5, "1.0.0"), state({ words: ["hat"] }));
    storage.setItem(hotAndColdBrowserKeys.daily(5, "1.1.0"), state({ judgingVersion: "1.1.0" }));
    storage.setItem(
      hotAndColdBrowserKeys.daily(5, "2.4.1"),
      state({ judgingVersion: "2.4.1", target: "scarf", words: ["hat", "scarf"] }),
    );

    const recovered = recoverDailyHotAndColdState(storage, 5, "3.0.0");

    expect(recovered).toMatchObject({
      key: hotAndColdBrowserKeys.daily(5, "2.4.1"),
      needsReplay: true,
      state: { target: "scarf", judgingVersion: "2.4.1" },
    });
    expect(recovered?.state.guesses.map(({ word }) => word)).toEqual(["hat", "scarf"]);
  });

  it("prefers the current revision when progress is equal", () => {
    const storage = new MemoryStorage();
    storage.setItem(hotAndColdBrowserKeys.legacyDaily(5), state({ words: ["hat"] }));
    storage.setItem(
      hotAndColdBrowserKeys.daily(5, "1.0.0"),
      state({ judgingVersion: "1.0.0", words: ["hat"] }),
    );

    expect(recoverDailyHotAndColdState(storage, 5, "1.0.0")).toMatchObject({
      key: hotAndColdBrowserKeys.daily(5, "1.0.0"),
      needsReplay: false,
    });
  });

  it("ignores damaged and unrelated saves", () => {
    const storage = new MemoryStorage();
    storage.setItem(hotAndColdBrowserKeys.daily(5, "1.0.0"), "not json");
    storage.setItem(
      hotAndColdBrowserKeys.daily(4, "0.9.0"),
      state({ puzzle: 4, judgingVersion: "0.9.0", target: "parade" }),
    );

    expect(recoverDailyHotAndColdState(storage, 5, "1.0.0")).toBeNull();
  });
});
