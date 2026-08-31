import { beforeEach, describe, expect, it } from "vitest";

import {
  emailFormDefault,
  forgetBrowserProfile,
  gameNameDefault,
  readBrowserProfile,
  rememberBrowserProfile,
} from "@/lib/client/browser-profile";

function makeStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  } as Storage;
}

beforeEach(() => {
  const localStorage = makeStorage();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorage });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage,
      dispatchEvent: () => true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
});

describe("browser profile", () => {
  it("normalises saved identity fields", () => {
    expect(
      rememberBrowserProfile({
        name: "  Alex Rivera  ",
        gameName: "  Lex  ",
        email: " ALEX@Example.COM ",
      }),
    ).toEqual({ name: "Alex Rivera", gameName: "Lex", email: "alex@example.com" });
    expect(readBrowserProfile()).toEqual({
      name: "Alex Rivera",
      gameName: "Lex",
      email: "alex@example.com",
    });
  });

  it("ignores malformed stored values", () => {
    localStorage.setItem("mah-browser-profile-v1", JSON.stringify({ name: 42, email: "nope" }));
    expect(readBrowserProfile()).toEqual({ name: "", gameName: "", email: "" });
  });

  it("prefers a trusted form email and falls back to the remembered profile", () => {
    expect(emailFormDefault(" SignedIn@Example.COM ", "remembered@example.com")).toBe(
      "signedin@example.com",
    );
    expect(emailFormDefault(undefined, " Remembered@Example.COM ")).toBe("remembered@example.com");
    expect(emailFormDefault("invalid", "remembered@example.com")).toBe("remembered@example.com");
  });

  it("can remove only the profile", () => {
    rememberBrowserProfile({ name: "Alex" });
    expect(forgetBrowserProfile()).toBe(true);
    expect(readBrowserProfile()).toEqual({ name: "", gameName: "", email: "" });
  });

  it("creates an editable code-point-safe game default from a longer preferred name", () => {
    expect(gameNameDefault("Alexandria Verylongname", 12)).toBe("Alexandria…");
    expect(gameNameDefault("🧡🧡🧡", 2)).toBe("🧡…");
  });
});
