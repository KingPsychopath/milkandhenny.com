import { createFileRoute } from "@tanstack/react-router";
import { setCookie } from "@/lib/http/cookies";
import { getClientIp } from "@/features/auth/auth.server";
import { isWordsEnabled } from "@/features/words/reader.server";
import {
  wordAccessCookieName,
  signWordAccessToken,
  verifyShareLinkAccess,
} from "@/features/words/share.server";

async function handlePOST(request: Request) {
  if (!isWordsEnabled()) {
    return Response.json({ error: "Words feature is disabled." }, { status: 404 });
  }

  let body: { slug?: string; token?: string; pin?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const slug = (body.slug ?? "").trim().toLowerCase();
  const token = (body.token ?? "").trim();
  if (!slug || !token) {
    return Response.json({ error: "slug and token are required." }, { status: 400 });
  }

  const verification = await verifyShareLinkAccess({
    slug,
    token,
    pin: body.pin,
    ip: getClientIp(request),
  });

  if (!verification.ok) {
    return Response.json(
      {
        error: verification.error,
        pinRequired: !!verification.pinRequired,
      },
      { status: verification.status },
    );
  }

  const accessToken = signWordAccessToken(verification.link);
  if (!accessToken) {
    return Response.json(
      { error: "AUTH_SECRET not configured strongly enough for share sessions." },
      { status: 503 },
    );
  }

  const expiresAtMs = new Date(verification.link.expiresAt).getTime();
  const maxAge = Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000));

  const res = Response.json({
    ok: true,
    pinRequired: verification.link.pinRequired,
    expiresAt: verification.link.expiresAt,
  });

  setCookie(res, wordAccessCookieName(slug), accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  return res;
}

export const Route = createFileRoute("/api/words/share/verify")({
  server: {
    handlers: {
      POST: ({ request }) => handlePOST(request),
    },
  },
});
