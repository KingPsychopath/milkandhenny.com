import { getRequest, setCookie } from "@tanstack/react-start/server";
import { handleVerifyRequest } from "./auth.server";
import { getAuthCookieMaxAgeSeconds, getAuthCookieName } from "./cookies";

export async function verifyAndSetAdminCookieForCli(password: string): Promise<boolean> {
  const incoming = getRequest();
  const headers = new Headers(incoming.headers);
  headers.set("content-type", "application/json");
  const response = await handleVerifyRequest(
    new Request(incoming.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ password }),
    }),
    "admin",
  );
  const result: unknown = await response.json().catch(() => null);
  const token =
    result && typeof result === "object" && "token" in result && typeof result.token === "string"
      ? result.token
      : "";
  if (!response.ok || !token) return false;

  setCookie(getAuthCookieName("admin"), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: getAuthCookieMaxAgeSeconds("admin"),
  });
  return true;
}
