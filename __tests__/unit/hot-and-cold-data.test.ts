import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  HOT_AND_COLD_ASSET_SCHEMA_VERSION,
  HOT_AND_COLD_JUDGING_VERSION,
} from "@/features/things/hot-and-cold/hot-and-cold-rules";
import { HOT_AND_COLD_TARGETS } from "@/features/things/hot-and-cold/hot-and-cold-words.server";

interface Manifest {
  aliases: Record<string, string>;
  hints: Record<string, string[]>;
  formatVersion: number;
  judgingVersion: string;
  rankPacks: Record<string, { file: string; offset: number }>;
  targetContexts: Record<string, string>;
  targetSenses: Record<string, { definition: string; synset: string }>;
  trails: Record<string, string[]>;
  words: string[];
}

const assetRoot = path.join(process.cwd(), "runtime-assets", "hot-and-cold");
const manifest = JSON.parse(
  fs.readFileSync(path.join(assetRoot, "lexicon.data"), "utf8"),
) as Manifest;
const wordIndex = new Map(manifest.words.map((word, index) => [word, index]));

function ranksFor(target: string) {
  const location = manifest.rankPacks[target];
  const bytes = fs.readFileSync(path.join(assetRoot, location.file));
  return new Uint16Array(bytes.buffer, bytes.byteOffset + location.offset, manifest.words.length);
}

describe("Hot and Cold generated data", () => {
  it("uses a substantial common-word lexicon without proper names", () => {
    expect(manifest.formatVersion).toBe(HOT_AND_COLD_ASSET_SCHEMA_VERSION);
    expect(manifest.judgingVersion).toBe(HOT_AND_COLD_JUDGING_VERSION);
    expect(manifest.words.length).toBeGreaterThan(30_000);
    expect(manifest.words).not.toContain("tyler");
    expect(manifest.words).toContain("london");
    expect(manifest.words).toContain("mozart");
    expect(manifest.aliases.dogs).toBe("dog");
    expect(manifest.words).toContain("watching");
    expect(manifest.aliases.watching).toBeUndefined();
    expect(manifest.aliases.won).toBe("win");
    expect(manifest.aliases.invasion).toBeUndefined();
    expect(manifest.words).toContain("glass");
    expect(manifest.words).toContain("glasses");
    expect(manifest.aliases.glasses).toBeUndefined();
    expect(Object.keys(manifest.aliases).some((form) => wordIndex.has(form))).toBe(false);
  });

  it("contains a complete ordinal rank table and three progressive hints for every target", () => {
    expect(new Set(Object.values(manifest.rankPacks).map(({ file }) => file))).toHaveLength(16);
    for (const target of HOT_AND_COLD_TARGETS) {
      const ranks = ranksFor(target);
      expect(ranks).toHaveLength(manifest.words.length);
      expect(ranks[wordIndex.get(target)!]).toBe(0);
      expect(new Set(ranks).size).toBe(manifest.words.length);
      expect(manifest.hints[target]).toHaveLength(3);
      expect(manifest.targetSenses[target]).toMatchObject({
        definition: expect.any(String),
        synset: expect.any(String),
      });
      expect(manifest.targetContexts[target]).toMatch(new RegExp(`^${target}: `));
      expect(manifest.trails[target]).toHaveLength(20);
      expect(manifest.trails[target][0]).toBe(target);
      expect(manifest.trails[target]).toEqual(
        [...manifest.trails[target]].sort(
          (left, right) => ranks[wordIndex.get(left)!] - ranks[wordIndex.get(right)!],
        ),
      );
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
