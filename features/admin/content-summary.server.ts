import { getAllAlbums, validateAllAlbums } from "@/features/media/albums.server";
import { isWordsEnabled } from "@/features/words/reader.server";
import { listAllWords } from "@/features/words/store.server";

/** Shared read model for the admin UI and the operational HTTP endpoint. */
export async function getAdminContentSummary() {
  const noteBlogs = isWordsEnabled()
    ? await listAllWords({ includeNonPublic: true, type: "blog" })
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
  const albums = await getAllAlbums();
  const invalidAlbums = await validateAllAlbums();

  return {
    blog: {
      totalPosts: posts.length,
      featuredPosts: posts.filter((post) => post.featured).length,
      postsWithImages: posts.filter((post) => post.hasImage).length,
      totalReadingMinutes: posts.reduce((sum, post) => sum + post.readingTime, 0),
      latestPostDate: posts[0]?.date ?? null,
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
      totalPhotos: albums.reduce((sum, album) => sum + album.photos.length, 0),
      albumsWithoutDescription: albums.filter((album) => !album.description?.trim()).length,
      invalidAlbumCount: invalidAlbums.length,
      latestAlbumDate: albums[0]?.date ?? null,
      recent: albums.slice(0, 5).map((album) => ({
        slug: album.slug,
        title: album.title,
        date: album.date,
        photoCount: album.photos.length,
      })),
    },
  };
}
