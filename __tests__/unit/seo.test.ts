import { describe, expect, it } from "vitest";

import { BASE_URL, SITE_NAME } from "@/lib/shared/config";
import { absoluteUrl, buildSeoHead, buildSeoMeta } from "@/lib/shared/seo";

describe("SEO metadata", () => {
  it("builds canonical article metadata with bounded text and typed images", () => {
    const head = buildSeoHead({
      title: `  ${"A".repeat(80)}  `,
      description: `A   description with   uneven spacing. ${"B".repeat(180)}`,
      path: "/words/launch-night",
      image: "/media/launch-night.webp",
      imageAlt: "Launch night",
      type: "article",
      publishedTime: "2026-08-26T12:00:00.000Z",
      modifiedTime: "2026-08-26T13:00:00.000Z",
    });

    expect(head.links).toEqual([
      { rel: "canonical", href: new URL("/words/launch-night", BASE_URL).toString() },
    ]);
    expect(head.meta).toContainEqual({ property: "og:site_name", content: SITE_NAME });
    expect(head.meta).toContainEqual({ property: "og:image:type", content: "image/webp" });
    expect(head.meta).toContainEqual({ name: "robots", content: "index, follow" });
    expect(head.meta).toContainEqual({
      property: "article:published_time",
      content: "2026-08-26T12:00:00.000Z",
    });
    expect(head.meta).toContainEqual({
      property: "article:modified_time",
      content: "2026-08-26T13:00:00.000Z",
    });
    const title = head.meta.find((entry) => "title" in entry);
    const description = head.meta.find((entry) => "name" in entry && entry.name === "description");
    expect(title && "title" in title ? title.title.length : 0).toBe(70);
    expect(description && "content" in description ? description.content.length : 0).toBe(160);
  });

  it("does not repeat private capability URLs in canonical or social metadata", () => {
    const head = buildSeoHead({
      title: "Private room",
      description: "A private room.",
      path: "/play/secret-token",
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    });

    expect(head.links).toEqual([]);
    expect(head.meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    expect(head.meta).toContainEqual({ name: "referrer", content: "no-referrer" });
    expect(head.meta.some((entry) => "property" in entry && entry.property === "og:url")).toBe(
      false,
    );
    expect(head.meta.some((entry) => "name" in entry && entry.name === "twitter:card")).toBe(false);
  });

  it("uses safe defaults for invalid URLs and standard image formats", () => {
    expect(absoluteUrl("http://[")).toBe(BASE_URL);
    expect(
      buildSeoMeta({ title: "Page", description: "Description", path: "/page" }),
    ).toContainEqual({ property: "og:image:type", content: "image/png" });
    expect(
      buildSeoMeta({
        title: "Photo",
        description: "Description",
        path: "/photo",
        image: "/photo.jpeg",
      }),
    ).toContainEqual({ property: "og:image:type", content: "image/jpeg" });
  });
});
