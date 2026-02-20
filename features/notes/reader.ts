import "server-only";

import { cookies } from "next/headers";
import { requireAuthFromServerContext } from "@/features/auth/server";
import { NOTES_ENABLED } from "./config";
import { noteAccessCookieName, verifyNoteAccessToken } from "./share";
import type { NoteMeta } from "./types";

function isNotesEnabled(): boolean {
  return NOTES_ENABLED;
}

function isPubliclyReadable(meta: NoteMeta): boolean {
  return meta.visibility === "public" || meta.visibility === "unlisted";
}

async function hasAdminAccessInServerContext(): Promise<boolean> {
  const auth = await requireAuthFromServerContext("admin");
  return auth.ok;
}

async function hasNoteCookieAccessForSlug(slug: string): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(noteAccessCookieName(slug))?.value ?? "";
  if (!token) return false;
  return verifyNoteAccessToken(slug, token);
}

async function canReadNoteInServerContext(meta: NoteMeta): Promise<boolean> {
  if (isPubliclyReadable(meta)) return true;
  if (await hasAdminAccessInServerContext()) return true;
  return hasNoteCookieAccessForSlug(meta.slug);
}

export {
  isNotesEnabled,
  isPubliclyReadable,
  hasAdminAccessInServerContext,
  canReadNoteInServerContext,
};
