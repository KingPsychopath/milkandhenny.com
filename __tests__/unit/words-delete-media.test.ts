import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  deleteObjects: vi.fn(async (keys: string[]) => keys.length),
  listObjects: vi.fn(),
}));

vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));
vi.mock("@/lib/platform/r2.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/platform/r2.server")>();
  return {
    ...original,
    isConfigured: () => true,
    uploadBuffer: vi.fn(async () => undefined),
    deleteObject: vi.fn(async () => undefined),
    listObjects: storage.listObjects,
    deleteObjects: storage.deleteObjects,
  };
});

import { createWord, deleteWord } from "@/features/words/store.server";

describe("word deletion media cleanup", () => {
  beforeEach(() => {
    storage.deleteObjects.mockClear();
    storage.listObjects.mockImplementation(async (_prefix: string, options: { scope: string }) => [
      {
        key: `words/media/delete-media-${options.scope}/hero.webp`,
        size: 12,
      },
    ]);
  });

  it("removes both public and private media copies before deleting the word", async () => {
    const slug = `delete-media-${Date.now()}`;
    await createWord({ slug, title: "Delete media", markdown: "body", visibility: "private" });

    await expect(deleteWord(slug)).resolves.toBe(true);
    expect(storage.listObjects).toHaveBeenCalledWith(`words/media/${slug}/`, { scope: "public" });
    expect(storage.listObjects).toHaveBeenCalledWith(`words/media/${slug}/`, { scope: "private" });
    expect(storage.deleteObjects).toHaveBeenCalledTimes(2);
  });
});
