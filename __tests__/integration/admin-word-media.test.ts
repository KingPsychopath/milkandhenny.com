import { beforeEach, describe, expect, it, vi } from "vitest";

describe("admin word media library", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("reads private word media from private storage through an authorised app URL", async () => {
    const listObjects = vi.fn(async (prefix: string, options: { scope: string }) => {
      if (prefix === "words/media/private-note/" && options.scope === "private") {
        return [
          {
            key: "words/media/private-note/portrait.webp",
            size: 42,
            lastModified: new Date("2026-08-27T10:00:00.000Z"),
          },
        ];
      }
      return [];
    });
    vi.doMock("@/features/auth/auth.server", () => ({ requireAuth: vi.fn(async () => null) }));
    vi.doMock("@/features/words/store.server", () => ({
      getWordMeta: vi.fn(async () => ({ slug: "private-note", visibility: "private" })),
      storageScopeForVisibility: () => "private",
    }));
    vi.doMock("@/lib/platform/r2.server", () => ({
      isConfigured: () => true,
      listObjects,
    }));

    const { GET } = await import("@/src/routes/api/admin/word-media/route");
    const response = await GET(
      new Request("http://localhost/api/admin/word-media?slug=private-note&includeAssets=false"),
    );
    const payload = (await response.json()) as {
      pageMedia: Array<{ key: string; url: string; size: number }>;
    };

    expect(response.status).toBe(200);
    expect(listObjects).toHaveBeenCalledWith("words/media/private-note/", { scope: "private" });
    expect(payload.pageMedia).toEqual([
      {
        key: "words/media/private-note/portrait.webp",
        filename: "portrait.webp",
        kind: "image",
        size: 42,
        lastModified: "2026-08-27T10:00:00.000Z",
        url: "/api/words/private-note/media/portrait.webp",
        markdown: "![portrait](words/media/private-note/portrait.webp)",
      },
    ]);
  });
});
