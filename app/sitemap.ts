import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog/reader";
import { getAllAlbums } from "@/lib/media/albums";
import { BASE_URL } from "@/lib/shared/config";

export default function sitemap(): MetadataRoute.Sitemap {
  const posts = getAllPosts();
  const albums = getAllAlbums();

  const postEntries: MetadataRoute.Sitemap = posts.map((post) => ({
    url: `${BASE_URL}/blog/${post.slug}`,
    lastModified: new Date(post.date + "T00:00:00"),
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  const albumEntries: MetadataRoute.Sitemap = albums.map((album) => ({
    url: `${BASE_URL}/pics/${album.slug}`,
    lastModified: new Date(album.date + "T00:00:00"),
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  return [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${BASE_URL}/pics`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/blog`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/party`,
      lastModified: new Date("2026-01-16"),
      changeFrequency: "yearly",
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/guestlist`,
      lastModified: new Date("2026-01-16"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/icebreaker`,
      lastModified: new Date("2026-01-16"),
      changeFrequency: "yearly",
      priority: 0.4,
    },
    {
      url: `${BASE_URL}/best-dressed`,
      lastModified: new Date("2026-01-16"),
      changeFrequency: "yearly",
      priority: 0.4,
    },
    ...postEntries,
    ...albumEntries,
  ];
}
