import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import { isWordsEnabled } from "./reader.server";
import { listWords } from "./store.server";
import type { WordVisibility } from "./content-types";
import type { WordType } from "./types";

export type AdminEditorWordFilters = {
  q: string;
  type: WordType | "all";
  visibility: WordVisibility | "all";
  tag: string;
};

export const getAdminEditorWordsFn = createServerFn({ method: "GET" })
  .validator((data: AdminEditorWordFilters) => ({
    q: data.q.trim().slice(0, 200),
    type: data.type,
    visibility: data.visibility,
    tag: data.tag.trim().toLowerCase().slice(0, 80),
  }))
  .handler(async ({ data }) => {
    const access = await getAdminWorkspaceAccess(getRequest());
    if (!access.ok || !access.permissions.manageContent)
      throw new Error("Content management access required");
    if (!isWordsEnabled()) throw new Error("Words feature is disabled");
    return listWords({
      limit: 200,
      q: data.q,
      ...(data.type !== "all" ? { type: data.type } : {}),
      ...(data.visibility !== "all" ? { visibility: data.visibility } : {}),
      ...(data.tag ? { tag: data.tag } : {}),
      includeNonPublic: true,
    });
  });
