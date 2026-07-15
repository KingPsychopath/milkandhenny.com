import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest, setCookie } from "@tanstack/react-start/server";
import { handleVerifyRequest } from "./auth.server";
import { getAuthCookieMaxAgeSeconds, getAuthCookieName } from "./cookies";
import type { AuthCookieRole } from "./cookies";

interface Credentials {
  value: string;
}

function readCredential(field: "pin" | "password") {
  return (input: unknown): Credentials => {
    if (!(input instanceof FormData)) throw new Error("Expected form data");
    return { value: input.get(field)?.toString() ?? "" };
  };
}

async function verifyAndSetCookie(
  role: AuthCookieRole,
  body: Record<string, string>,
): Promise<boolean> {
  const incoming = getRequest();
  const headers = new Headers(incoming.headers);
  headers.set("content-type", "application/json");
  if (!headers.has("x-forwarded-for")) headers.set("x-forwarded-for", "127.0.0.1");

  const response = await handleVerifyRequest(
    new Request(incoming.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    role,
  );
  const result: unknown = await response.json().catch(() => null);
  const token =
    result && typeof result === "object" && "token" in result && typeof result.token === "string"
      ? result.token
      : "";
  if (!response.ok || !token) return false;

  setCookie(getAuthCookieName(role), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: getAuthCookieMaxAgeSeconds(role),
  });
  return true;
}

export const signInStaff = createServerFn({ method: "POST" })
  .validator(readCredential("pin"))
  .handler(async ({ data }) => {
    const ok = await verifyAndSetCookie("staff", { pin: data.value });
    throw redirect({ href: ok ? "/guestlist" : "/guestlist?auth=failed" });
  });

export const signInAdmin = createServerFn({ method: "POST" })
  .validator(readCredential("password"))
  .handler(async ({ data }) => {
    const ok = await verifyAndSetCookie("admin", { password: data.value });
    throw redirect({ href: ok ? "/admin" : "/admin?auth=failed" });
  });

export const signInUpload = createServerFn({ method: "POST" })
  .validator(readCredential("pin"))
  .handler(async ({ data }) => {
    const ok = await verifyAndSetCookie("upload", { pin: data.value });
    throw redirect({ href: ok ? "/upload" : "/upload?auth=failed" });
  });

export const signOut = createServerFn({ method: "POST" })
  .validator((data: { role: AuthCookieRole; nextPath?: string }) => data)
  .handler(({ data }) => {
    setCookie(getAuthCookieName(data.role), "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    const nextPath =
      data.nextPath?.startsWith("/") && !data.nextPath.startsWith("//") ? data.nextPath : "/";
    throw redirect({ href: nextPath });
  });
