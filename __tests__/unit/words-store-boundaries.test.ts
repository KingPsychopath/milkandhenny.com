import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));
vi.mock("@/lib/platform/r2.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/platform/r2.server")>();
  return { ...original, isConfigured: () => false };
});

import type { WordVisibility } from "@/features/words/content-types";
import { createWord, deleteWord, listAllWords, listWords } from "@/features/words/store.server";
import { createShareLink, toShareLinkView } from "@/features/words/share.server";

function uniquePrefix(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("words persistence boundaries", () => {
  it("fails closed without durable metadata and share persistence in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await expect(listAllWords({ includeNonPublic: true })).rejects.toThrow(
      "Word metadata persistence is unavailable",
    );
    await expect(
      createShareLink({ slug: uniquePrefix("share-unavailable"), pinRequired: false }),
    ).rejects.toThrow("Word share persistence is unavailable");
  });

  it("rejects unknown visibility values at the durable workflow boundary", async () => {
    await expect(
      createWord({
        slug: uniquePrefix("invalid-visibility"),
        title: "Invalid visibility",
        markdown: "body",
        visibility: "secret" as WordVisibility,
      }),
    ).rejects.toThrow("Invalid visibility value");
  });

  it("serializes concurrent creates for the same slug", async () => {
    const slug = uniquePrefix("concurrent-create");
    const results = await Promise.allSettled(
      ["first", "second"].map((title) =>
        createWord({ slug, title, markdown: title, visibility: "private" }),
      ),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await deleteWord(slug);
  });

  it("keeps public pagination bounded while trusted internal reads return every match", async () => {
    const prefix = uniquePrefix("all-words");
    const slugs = Array.from({ length: 105 }, (_, index) => `${prefix}-${index + 1}`);
    await Promise.all(
      slugs.map((slug, index) =>
        createWord({
          slug,
          title: `Word ${index + 1}`,
          markdown: "body",
          visibility: "private",
        }),
      ),
    );

    const publicPage = await listWords({ includeNonPublic: true, q: prefix, limit: 1_000 });
    const internal = await listAllWords({ includeNonPublic: true, q: prefix });

    expect(publicPage.words).toHaveLength(100);
    expect(publicPage.nextCursor).toBeTruthy();
    expect(internal).toHaveLength(105);

    await Promise.all(slugs.map((slug) => deleteWord(slug)));
  });

  it("removes credential hashes from share responses", async () => {
    const created = await createShareLink({
      slug: uniquePrefix("share-view"),
      pinRequired: true,
      pin: "2580",
    });

    expect(toShareLinkView(created.link)).toEqual({
      id: created.link.id,
      slug: created.link.slug,
      expiresAt: created.link.expiresAt,
      pinRequired: true,
      revokedAt: undefined,
      createdAt: created.link.createdAt,
      updatedAt: created.link.updatedAt,
    });
    expect(toShareLinkView(created.link)).not.toHaveProperty("tokenHash");
    expect(toShareLinkView(created.link)).not.toHaveProperty("pinHash");
  });
});
