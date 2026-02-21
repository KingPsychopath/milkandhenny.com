import "server-only";

import { cookies } from "next/headers";
import { requireAuthFromServerContext } from "@/features/auth/server";
import { verifyWordAccessToken, wordAccessCookieName } from "./share";
import type { NoteMeta } from "./content-types";

function isWordsEnabled(): boolean {
  return true;
}

function isPubliclyReadable(meta: NoteMeta): boolean {
  return meta.visibility === "public" || meta.visibility === "unlisted";
}

async function hasAdminAccessInServerContext(): Promise<boolean> {
  const auth = await requireAuthFromServerContext("admin");
  return auth.ok;
}

async function hasWordCookieAccessForSlug(slug: string): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(wordAccessCookieName(slug))?.value ?? "";
  if (!token) return false;
  return verifyWordAccessToken(slug, token);
}

async function canReadWordInServerContext(meta: NoteMeta): Promise<boolean> {
  if (isPubliclyReadable(meta)) return true;
  if (await hasAdminAccessInServerContext()) return true;
  return hasWordCookieAccessForSlug(meta.slug);
}

export {
  isWordsEnabled,
  isPubliclyReadable,
  hasAdminAccessInServerContext,
  canReadWordInServerContext,
};
