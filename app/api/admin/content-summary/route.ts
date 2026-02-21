import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/features/auth/server";
import { getAllAlbums, validateAllAlbums } from "@/features/media/albums";
import { isWordsEnabled } from "@/features/words/reader";
import { listWords } from "@/features/words/store";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const noteBlogs = isWordsEnabled()
      ? (await listWords({
          includeNonPublic: true,
          type: "blog",
          limit: 1000,
        })).words
      : [];

    const posts = noteBlogs
      .map((note) => ({
        slug: note.slug,
        title: note.title,
        date: note.publishedAt ?? note.updatedAt,
        readingTime: note.readingTime,
        featured: note.featured ?? false,
        hasImage: !!note.image,
      }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const albums = getAllAlbums();
    const invalidAlbums = validateAllAlbums();

    const featuredPosts = posts.filter((post) => post.featured).length;
    const postsWithImages = posts.filter((post) => post.hasImage).length;
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
          featured: post.featured,
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
    return apiErrorFromRequest(request, "admin.content-summary", "Failed to load content summary", error);
  }
}
