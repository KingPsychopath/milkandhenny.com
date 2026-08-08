import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PROMPT_WINDOW_HOURS,
  forgetScanner,
  readRememberedScanners,
  rememberScanner,
  scannerToPromptFor,
} from "@/features/tickets/scanner-memory";

/**
 * The on-device scanner memory backs the "back to scanning?" prompt and the
 * /scan resume page. It must tolerate garbage storage, prune stale entries,
 * and never throw — a crash here would take the whole page shell down.
 */

function stubLocalStorage() {
  const data = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
  vi.stubGlobal("window", { localStorage });
  return data;
}

describe("scanner memory", () => {
  let data: Map<string, string>;

  beforeEach(() => {
    data = stubLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const entry = (token: string, label = "Alice") => ({
    token,
    label,
    station: "door",
    eventTitle: "Launch Night",
  });

  it("remembers newest first and de-duplicates by token", () => {
    rememberScanner(entry("scn_aaaaaaaaaaaaaaaaaaaaaaaaaa"));
    rememberScanner(entry("scn_bbbbbbbbbbbbbbbbbbbbbbbbbb", "Bea"));
    rememberScanner(entry("scn_aaaaaaaaaaaaaaaaaaaaaaaaaa"));

    const remembered = readRememberedScanners();
    expect(remembered.map((item) => item.token)).toEqual([
      "scn_aaaaaaaaaaaaaaaaaaaaaaaaaa",
      "scn_bbbbbbbbbbbbbbbbbbbbbbbbbb",
    ]);
  });

  it("caps how many scanners a device remembers", () => {
    for (let i = 0; i < 6; i += 1) {
      rememberScanner(entry(`scn_${String(i).repeat(26)}`, `Helper ${i}`));
    }
    expect(readRememberedScanners()).toHaveLength(4);
  });

  it("forgets one link, or all of them", () => {
    rememberScanner(entry("scn_aaaaaaaaaaaaaaaaaaaaaaaaaa"));
    rememberScanner(entry("scn_bbbbbbbbbbbbbbbbbbbbbbbbbb", "Bea"));

    forgetScanner("scn_aaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(readRememberedScanners().map((item) => item.token)).toEqual([
      "scn_bbbbbbbbbbbbbbbbbbbbbbbbbb",
    ]);

    forgetScanner();
    expect(readRememberedScanners()).toEqual([]);
  });

  it("prunes entries older than the remember window", () => {
    rememberScanner(entry("scn_aaaaaaaaaaaaaaaaaaaaaaaaaa"));
    const fifteenDays = 15 * 24 * 60 * 60 * 1000;
    expect(readRememberedScanners(Date.now() + fifteenDays)).toEqual([]);
  });

  it("only prompts while the latest scanner is fresh", () => {
    rememberScanner(entry("scn_aaaaaaaaaaaaaaaaaaaaaaaaaa"));
    expect(scannerToPromptFor()?.token).toBe("scn_aaaaaaaaaaaaaaaaaaaaaaaaaa");

    const past = Date.now() + (PROMPT_WINDOW_HOURS + 1) * 60 * 60 * 1000;
    expect(scannerToPromptFor(past)).toBeNull();
  });

  it("survives garbage in storage", () => {
    data.set("mah-scanner-access", "{not json");
    expect(readRememberedScanners()).toEqual([]);
    data.set("mah-scanner-access", JSON.stringify([{ nonsense: true }, 42]));
    expect(readRememberedScanners()).toEqual([]);
    // And writing over garbage works.
    rememberScanner(entry("scn_aaaaaaaaaaaaaaaaaaaaaaaaaa"));
    expect(readRememberedScanners()).toHaveLength(1);
  });

  it("no-ops without a browser", () => {
    vi.unstubAllGlobals();
    expect(readRememberedScanners()).toEqual([]);
    expect(() => rememberScanner(entry("scn_aaaaaaaaaaaaaaaaaaaaaaaaaa"))).not.toThrow();
    expect(() => forgetScanner()).not.toThrow();
    expect(scannerToPromptFor()).toBeNull();
  });
});
