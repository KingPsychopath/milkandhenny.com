import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/features/auth/server";
import { isWordsEnabled } from "@/features/words/reader";
import {
  wordAccessCookieName,
  signWordAccessToken,
  verifyShareLinkAccess,
} from "@/features/words/share";

export async function POST(request: NextRequest) {
  if (!isWordsEnabled()) {
    return NextResponse.json({ error: "Words feature is disabled." }, { status: 404 });
  }

  let body: { slug?: string; token?: string; pin?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const slug = (body.slug ?? "").trim().toLowerCase();
  const token = (body.token ?? "").trim();
  if (!slug || !token) {
    return NextResponse.json({ error: "slug and token are required." }, { status: 400 });
  }

  const verification = await verifyShareLinkAccess({
    slug,
    token,
    pin: body.pin,
    ip: getClientIp(request),
  });

  if (!verification.ok) {
    return NextResponse.json(
      {
        error: verification.error,
        pinRequired: !!verification.pinRequired,
      },
      { status: verification.status }
    );
  }

  const accessToken = signWordAccessToken(verification.link);
  if (!accessToken) {
    return NextResponse.json(
      { error: "AUTH_SECRET not configured strongly enough for share sessions." },
      { status: 503 }
    );
  }

  const expiresAtMs = new Date(verification.link.expiresAt).getTime();
  const maxAge = Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000));

  const res = NextResponse.json({
    ok: true,
    pinRequired: verification.link.pinRequired,
    expiresAt: verification.link.expiresAt,
  });

  res.cookies.set({
    name: wordAccessCookieName(slug),
    value: accessToken,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  return res;
}
