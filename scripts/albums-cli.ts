import fs from "node:fs";
import path from "node:path";

import {
  createAdminAlbum,
  deleteAlbum,
  deleteAlbumPhoto,
  finalizeAlbumUploads,
  listAdminAlbums,
  prepareAlbumUploads,
  reorderAlbumPhotos,
  setAlbumCover,
  updateAlbumMetadata,
  updateAlbumPhoto,
} from "../features/media/admin-albums";
import { getMimeType, isProcessableImage } from "../features/media/processing.server";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function required(args: string[], name: string): string {
  const value = option(args, name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

async function uploadDirectory(slug: string, directory: string) {
  const absolute = path.resolve(directory.replace(/^~/, process.env.HOME ?? "~"));
  const files = fs
    .readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isProcessableImage(entry.name))
    .map((entry) => {
      const filePath = path.join(absolute, entry.name);
      const stat = fs.statSync(filePath);
      return { filePath, name: entry.name, size: stat.size, type: getMimeType(entry.name) };
    });
  if (!files.length) throw new Error("No supported images found in that directory");

  const prepared = await prepareAlbumUploads(
    slug,
    files.map(({ name, size, type }) => ({ name, size, type })),
  );
  await Promise.all(
    prepared.map(async (upload, index) => {
      const response = await fetch(upload.url, {
        method: "PUT",
        headers: { "Content-Type": upload.contentType },
        body: fs.readFileSync(files[index].filePath),
      });
      if (!response.ok) throw new Error(`Storage rejected ${upload.original}: ${response.status}`);
    }),
  );
  return finalizeAlbumUploads(slug, prepared);
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export async function runAlbumsCli(command: "albums" | "photos", args: string[]): Promise<void> {
  const action = args[1];
  if (command === "albums") {
    if (action === "list") return print(await listAdminAlbums());
    if (action === "create") {
      return print(
        await createAdminAlbum({
          slug: required(args, "slug"),
          title: required(args, "title"),
          date: required(args, "date"),
          description: option(args, "description"),
        }),
      );
    }
    const slug = args[2];
    if (!slug) throw new Error(`Usage: pnpm cli albums ${action ?? "<action>"} <slug>`);
    if (action === "update") {
      return print(
        await updateAlbumMetadata(slug, {
          title: option(args, "title"),
          date: option(args, "date"),
          description: option(args, "description"),
          status: option(args, "status"),
        }),
      );
    }
    if (action === "upload") return print(await uploadDirectory(slug, required(args, "dir")));
    if (action === "delete") {
      if (!args.includes("--yes")) throw new Error("Album deletion requires --yes");
      return print(await deleteAlbum(slug));
    }
    throw new Error("Use albums list|create|update|upload|delete");
  }

  const slug = args[2];
  if (!slug) throw new Error(`Usage: pnpm cli photos ${action ?? "<action>"} <album> ...`);
  if (action === "add") return print(await uploadDirectory(slug, required(args, "dir")));
  const photoId = args[3];
  if (action === "delete") {
    if (!photoId || !args.includes("--yes"))
      throw new Error("Photo deletion needs an ID and --yes");
    return print(await deleteAlbumPhoto(slug, photoId));
  }
  if (action === "set-cover") {
    if (!photoId) throw new Error("Photo ID is required");
    return print(await setAlbumCover(slug, photoId));
  }
  if (action === "update") {
    if (!photoId) throw new Error("Photo ID is required");
    return print(
      await updateAlbumPhoto(slug, photoId, {
        title: option(args, "title"),
        alt: option(args, "alt"),
        caption: option(args, "caption"),
        focalPoint: option(args, "focal"),
      }),
    );
  }
  if (action === "reorder") {
    const ids = required(args, "ids")
      .split(",")
      .map((id) => id.trim());
    return print(await reorderAlbumPhotos(slug, ids));
  }
  throw new Error("Use photos add|delete|set-cover|update|reorder");
}
