import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));
vi.mock("@/lib/platform/r2.server", async (original) => ({
  ...(await original<typeof import("@/lib/platform/r2.server")>()),
  isConfigured: () => false,
}));
import { createWord, deleteWord, getWord, listAllWords } from "@/features/words/store.server";
import {
  exportWordArchive,
  parseWordArchive,
  restoreWordArchive,
} from "@/features/words/archive.server";

describe("word disaster recovery", () => {
  it("recovers public and private metadata, bodies, dates, and media references without sessions", async () => {
    const first = await createWord({
      slug: "archive-public",
      title: "Public",
      visibility: "public",
      markdown: "![photo](words/media/archive-public/photo.webp)",
      image: "words/media/archive-public/photo.webp",
      createdAt: "2026-01-01T12:00:00.000Z",
    });
    const second = await createWord({
      slug: "archive-private",
      title: "Private draft",
      visibility: "private",
      markdown: "Unfinished writing",
    });
    const archive = await exportWordArchive();
    expect(parseWordArchive(archive)).toHaveLength(2);
    await expect(restoreWordArchive(archive)).rejects.toThrow("empty target");
    await deleteWord(first.meta.slug);
    await deleteWord(second.meta.slug);
    expect(await listAllWords({ includeNonPublic: true })).toHaveLength(0);
    expect(await restoreWordArchive(archive)).toBe(2);
    expect(await getWord(first.meta.slug)).toEqual(first);
    expect(await getWord(second.meta.slug)).toEqual(second);
    await deleteWord(first.meta.slug);
    await deleteWord(second.meta.slug);
  });
  it("rejects corrupted archives before any storage write", () => {
    expect(() =>
      parseWordArchive(
        JSON.stringify({ format: "mah-words-v1", sha256: "wrong", payload: '{"records":[]}' }),
      ),
    ).toThrow("checksum");
  });
});
