"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextRequest } from "next/server";
import { handleVerifyRequest } from "./server";
import { getAuthCookieMaxAgeSeconds, getAuthCookieName, type AuthCookieRole } from "./cookies";

type VerifyRole = Exclude<AuthCookieRole, never>;

// Synthetic in-memory request URL used to reuse API-style helpers (NextRequest-based)
// from Server Actions. This is NOT a real route and is never fetched over HTTP.
const INTERNAL_ACTIONS_URL_BASE = "http://localhost/__internal_actions";

async function buildNextRequest(jsonBody: unknown): Promise<NextRequest> {
  const h = new Headers(await headers());
  h.set("content-type", "application/json");
  // Ensure a stable IP for rate limiting even when missing.
  if (!h.get("x-forwarded-for")) h.set("x-forwarded-for", "127.0.0.1");

  const req = new Request(`${INTERNAL_ACTIONS_URL_BASE}/auth/verify`, {
    method: "POST",
    headers: h,
    body: JSON.stringify(jsonBody),
  });
  return new NextRequest(req);
}

async function verifyAndSetCookie(role: VerifyRole, jsonBody: unknown) {
  const req = await buildNextRequest(jsonBody);
  const res = await handleVerifyRequest(req, role);
  const data = (await res.json().catch(() => ({}))) as { token?: string; ok?: boolean; error?: string };
  const token = typeof data.token === "string" ? data.token : "";
  if (!res.ok || !token) {
    return { ok: false as const, status: res.status || 401, error: data.error || "Unauthorized" };
  }

  const jar = await cookies();
  jar.set({
    name: getAuthCookieName(role),
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: getAuthCookieMaxAgeSeconds(role),
  });

  return { ok: true as const };
}

export async function signInStaffAction(formData: FormData) {
  const pin = typeof formData.get("pin") === "string" ? (formData.get("pin") as string) : "";
  const result = await verifyAndSetCookie("staff", { pin });
  if (!result.ok) {
    redirect(`/guestlist?auth=failed`);
  }
  redirect("/guestlist");
}

export async function signInAdminAction(formData: FormData) {
  const password =
    typeof formData.get("password") === "string" ? (formData.get("password") as string) : "";
  const result = await verifyAndSetCookie("admin", { password });
  if (!result.ok) {
    redirect(`/admin?auth=failed`);
  }
  redirect("/admin");
}

export async function signOutAction(role: VerifyRole, nextPath = "/") {
  const jar = await cookies();
  jar.set({
    name: getAuthCookieName(role),
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  redirect(nextPath);
}
