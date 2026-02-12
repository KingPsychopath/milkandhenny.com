import { NextRequest } from "next/server";

/**
 * Proxy download route to avoid CORS issues with R2.
 * GET /api/download?url=https://pub-xxx.r2.dev/albums/...
 *
 * Security: Only allows fetching from our own R2 bucket URL.
 * Streams the image back with a Content-Disposition header to trigger download.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  if (!url) {
    return new Response("Missing url param", { status: 400 });
  }

  /* ── Only allow our own R2 bucket ── */
  const allowedOrigin = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (!allowedOrigin || !url.startsWith(allowedOrigin)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const res = await fetch(url);

    if (!res.ok) {
      return new Response("Failed to fetch image", { status: res.status });
    }

    const blob = await res.blob();
    const filename = url.split("/").pop() ?? "photo.jpg";

    return new Response(blob, {
      headers: {
        "Content-Type": blob.type || "image/jpeg",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Download failed", { status: 500 });
  }
}
