import { queryOptions } from "@tanstack/react-query";
import {
  getAdminEditorWordFn,
  getAdminEditorWordsFn,
  type AdminEditorWordFilters,
} from "./admin-editor.functions";

export const EMPTY_ADMIN_EDITOR_FILTERS: AdminEditorWordFilters = {
  q: "",
  type: "all",
  visibility: "all",
  tag: "",
};

export const adminEditorWordsQuery = (filters: AdminEditorWordFilters) =>
  queryOptions({
    queryKey: ["admin", "words", "editor-list", filters] as const,
    queryFn: () => getAdminEditorWordsFn({ data: filters }),
    staleTime: 10_000,
    retry: false,
  });

export const adminEditorWordQuery = (slug: string) =>
  queryOptions({
    queryKey: ["admin", "words", "editor-detail", slug] as const,
    queryFn: () => getAdminEditorWordFn({ data: { slug } }),
    staleTime: 5_000,
    retry: false,
  });
