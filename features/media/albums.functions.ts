import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { getAlbumBySlug, getAllAlbums } from "./albums.server";

export const getAlbumsPageFn = createServerFn({ method: "GET" }).handler(() => getAllAlbums());

export const getAlbumPageFn = createServerFn({ method: "GET" })
  .validator((data: { album: string }) => data)
  .handler(async ({ data }) => {
    const album = await getAlbumBySlug(data.album);
    if (!album) throw notFound();
    const albums = await getAllAlbums();
    const currentIndex = albums.findIndex((item) => item.slug === album.slug);
    const olderAlbum = albums[currentIndex + 1];
    const newerAlbum = currentIndex > 0 ? albums[currentIndex - 1] : undefined;
    return {
      album,
      olderAlbum: olderAlbum ? { slug: olderAlbum.slug, title: olderAlbum.title } : null,
      newerAlbum: newerAlbum ? { slug: newerAlbum.slug, title: newerAlbum.title } : null,
    };
  });

export const getPhotoPageFn = createServerFn({ method: "GET" })
  .validator((data: { album: string; photo: string }) => data)
  .handler(async ({ data }) => {
    const album = await getAlbumBySlug(data.album);
    if (!album) throw notFound();
    const photoIndex = album.photos.findIndex((photo) => photo.id === data.photo);
    if (photoIndex === -1) throw notFound();
    return { album, photoIndex };
  });
