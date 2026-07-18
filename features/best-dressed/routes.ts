import { buildAppUrl } from "@/lib/shared/app-url";

export function bestDressedPath() {
  return "/best-dressed";
}

export function buildBestDressedUrl(origin: string, code?: string) {
  return buildAppUrl(origin, bestDressedPath(), { search: code ? { code } : undefined });
}
