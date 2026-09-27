import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import { listAdminAlbums } from "./admin-albums";
import type { Album } from "./albums";

export const getAdminAlbumsFn = createServerFn({ method: "GET" }).handler(async () => {
  const access = await getAdminWorkspaceAccess(getRequest());
  if (!access.ok || !access.permissions.manageContent)
    throw new Error("Content management access required");
  const albums: Album[] = await listAdminAlbums();
  return albums;
});
