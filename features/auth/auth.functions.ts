import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest, setCookie } from "@tanstack/react-start/server";
import {
  authenticateRequest,
  getLocalDevAdminCookieValue,
  handleVerifyRequest,
  isLocalDevelopment,
  revokeCurrentSession,
} from "./auth.server";
import {
  getUploadAccessWindow,
  toUploadAccessCookieOptions,
  UPLOAD_ACCESS_COOKIE,
} from "./upload-access.server";
import {
  getAuthCookieMaxAgeSeconds,
  getAuthCookieName,
  LOCAL_DEV_ADMIN_COOKIE,
  LOCAL_DEV_ADMIN_COOKIE_MAX_AGE_SECONDS,
} from "./cookies";
import type { AuthCookieRole } from "./cookies";

interface Credentials {
  value: string;
}

export const getAdminAccessFn = createServerFn({ method: "GET" }).handler(async () => ({
  auth: await authenticateRequest(getRequest(), "admin"),
  localDevBypassAvailable: isLocalDevelopment(),
}));

export const getAdminEditorAccessFn = createServerFn({ method: "GET" }).handler(() =>
  authenticateRequest(getRequest(), "admin"),
);

export const getUploadAccessFn = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const openWindow = await getUploadAccessWindow();
  setCookie(
    UPLOAD_ACCESS_COOKIE,
    openWindow?.token ?? "",
    toUploadAccessCookieOptions(
      openWindow ? Math.ceil((Date.parse(openWindow.expiresAt) - Date.now()) / 1000) : 0,
    ),
  );
  const [auth, adminAuth] = await Promise.all([
    authenticateRequest(request, "upload"),
    authenticateRequest(request, "admin"),
  ]);
  return {
    isAuthed: auth.ok || Boolean(openWindow),
    isAdmin: adminAuth.ok,
    uploadAccessExpiresAt: openWindow?.expiresAt ?? null,
  };
});

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

export const signInAdmin = createServerFn({ method: "POST" })
  .validator(readCredential("password"))
  .handler(async ({ data }) => {
    const ok = await verifyAndSetCookie("admin", { password: data.value });
    throw redirect({ href: ok ? "/admin" : "/admin?auth=failed" });
  });

export const signInAdminDevelopment = createServerFn({ method: "POST" }).handler(async () => {
  const value = isLocalDevelopment() ? getLocalDevAdminCookieValue() : null;
  if (!value) throw redirect({ href: "/admin?auth=dev-unavailable" });

  setCookie(LOCAL_DEV_ADMIN_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: LOCAL_DEV_ADMIN_COOKIE_MAX_AGE_SECONDS,
  });
  throw redirect({ href: "/admin" });
});

export const signInUpload = createServerFn({ method: "POST" })
  .validator(readCredential("pin"))
  .handler(async ({ data }) => {
    const ok = await verifyAndSetCookie("upload", { pin: data.value });
    throw redirect({ href: ok ? "/upload" : "/upload?auth=failed" });
  });

export const signOut = createServerFn({ method: "POST" })
  .validator((data: { role: AuthCookieRole; nextPath?: string }) => data)
  .handler(async ({ data }) => {
    const request = getRequest();
    const revoked = await revokeCurrentSession(request, data.role);
    setCookie(getAuthCookieName(data.role), "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    if (data.role === "admin") {
      setCookie(LOCAL_DEV_ADMIN_COOKIE, "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0,
      });
    }
    const nextPath =
      data.nextPath?.startsWith("/") && !data.nextPath.startsWith("//") ? data.nextPath : "/";
    const failureSuffix = nextPath.includes("?") ? "&auth=logout-failed" : "?auth=logout-failed";
    throw redirect({ href: revoked ? nextPath : `${nextPath}${failureSuffix}` });
  });
