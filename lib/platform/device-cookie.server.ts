import { randomBytes } from "node:crypto";

import { getCookie, setCookie } from "@tanstack/react-start/server";

const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** An anonymous device marker; the cookie itself grants no access. */
export function ensureServerDeviceId(cookieName: string): string {
  const existing = getCookie(cookieName);
  if (existing && DEVICE_ID_PATTERN.test(existing)) return existing;

  const deviceId = randomBytes(12).toString("base64url");
  setCookie(cookieName, deviceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 60,
  });
  return deviceId;
}
