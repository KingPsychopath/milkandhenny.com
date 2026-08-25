import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOT_AND_COLD_TARGETS } from "@/features/things/hot-and-cold/hot-and-cold-words.server";

interface Manifest {
  aliases: Record<string, string>;
  hints: Record<string, string[]>;
  version: number;
  words: string[];
}

const assetRoot = path.join(process.cwd(), "assets", "hot-and-cold");
const manifest = JSON.parse(
  fs.readFileSync(path.join(assetRoot, "lexicon.data"), "utf8"),
) as Manifest;
const wordIndex = new Map(manifest.words.map((word, index) => [word, index]));

function ranksFor(target: string) {
  const bytes = fs.readFileSync(path.join(assetRoot, "ranks", `${target}.bin`));
  return new Uint16Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength / Uint16Array.BYTES_PER_ELEMENT,
  );
}

describe("Hot and Cold generated data", () => {
  it("uses a substantial common-word lexicon without proper names", () => {
    expect(manifest.version).toBe(1);
    expect(manifest.words.length).toBeGreaterThan(30_000);
    expect(manifest.words).not.toContain("tyler");
    expect(manifest.words).toContain("london");
    expect(manifest.words).toContain("mozart");
    expect(manifest.aliases.dogs).toBe("dog");
    expect(manifest.aliases.watching).toBe("watch");
    expect(manifest.aliases.won).toBe("win");
    expect(manifest.aliases.invasion).toBeUndefined();
  });

  it("contains a complete ordinal rank table and three progressive hints for every target", () => {
    for (const target of HOT_AND_COLD_TARGETS) {
      const ranks = ranksFor(target);
      expect(ranks).toHaveLength(manifest.words.length);
      expect(ranks[wordIndex.get(target)!]).toBe(0);
      expect(new Set(ranks).size).toBe(manifest.words.length);
      expect(manifest.hints[target]).toHaveLength(3);
      expect(manifest.hints[target].map((word) => ranks[wordIndex.get(word)!])).toEqual(
        manifest.hints[target]
          .map((word) => ranks[wordIndex.get(word)!])
          .sort((left, right) => right - left),
      );
    }
  });

  it("keeps familiar semantic neighbours ahead of unrelated or sub-token matches", () => {
    const banana = ranksFor("banana");
    const music = ranksFor("music");
    expect(banana[wordIndex.get("mango")!]).toBeLessThan(banana[wordIndex.get("car")!]);
    expect(music[wordIndex.get("melody")!]).toBeLessThan(music[wordIndex.get("medicine")!]);
  });
});
