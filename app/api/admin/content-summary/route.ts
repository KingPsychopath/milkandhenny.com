import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getAllPosts } from "@/lib/blog";
import { getAllAlbums, validateAllAlbums } from "@/lib/media/albums";
import { apiError } from "@/lib/api-error";

export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const posts = getAllPosts();
    const albums = getAllAlbums();
    const invalidAlbums = validateAllAlbums();

    const featuredPosts = posts.filter((post) => post.featured).length;
    const postsWithImages = posts.filter((post) => !!post.image).length;
    const totalReadingMinutes = posts.reduce((sum, post) => sum + post.readingTime, 0);
    const latestPostDate = posts[0]?.date ?? null;

    const totalPhotos = albums.reduce((sum, album) => sum + album.photos.length, 0);
    const albumsWithoutDescription = albums.filter((album) => !album.description?.trim()).length;
    const latestAlbumDate = albums[0]?.date ?? null;

    return NextResponse.json({
      blog: {
        totalPosts: posts.length,
        featuredPosts,
        postsWithImages,
        totalReadingMinutes,
        latestPostDate,
        recent: posts.slice(0, 5).map((post) => ({
          slug: post.slug,
          title: post.title,
          date: post.date,
          readingTime: post.readingTime,
          featured: post.featured ?? false,
        })),
      },
      gallery: {
        totalAlbums: albums.length,
        totalPhotos,
        albumsWithoutDescription,
        invalidAlbumCount: invalidAlbums.length,
        latestAlbumDate,
        recent: albums.slice(0, 5).map((album) => ({
          slug: album.slug,
          title: album.title,
          date: album.date,
          photoCount: album.photos.length,
        })),
      },
    });
  } catch (error) {
    return apiError("admin.content-summary", "Failed to load content summary", error);
  }
}
