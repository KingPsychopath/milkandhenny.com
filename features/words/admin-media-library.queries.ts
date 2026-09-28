import { queryOptions } from "@tanstack/react-query";
import type { WordMediaResponse } from "./admin-media-library.types";

async function readLibrary(slug: string, includeAssets: boolean): Promise<WordMediaResponse> {
  const params = new URLSearchParams({ slug, includeAssets: String(includeAssets) });
  const response = await fetch(`/api/admin/word-media?${params}`);
  const data = (await response.json().catch(() => ({}))) as WordMediaResponse;
  if (!response.ok) throw new Error(data.error ?? "Failed to load media library");
  return data;
}

export const adminWordPageMediaQuery = (slug: string) =>
  queryOptions({
    queryKey: ["admin", "words", "media", "page", slug] as const,
    queryFn: () => readLibrary(slug, false),
    staleTime: 15_000,
    retry: false,
  });

export const adminWordSharedAssetsQuery = queryOptions({
  queryKey: ["admin", "words", "media", "shared-assets"] as const,
  queryFn: () => readLibrary("", true),
  staleTime: 60_000,
  retry: false,
});
