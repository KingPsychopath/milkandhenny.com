import { createFileRoute } from "@tanstack/react-router";
import { canReadWordInServerContext } from "@/features/words/reader.server";
import { getWordMeta } from "@/features/words/store.server";
import { deleteObject, headObject, presignGetUrl } from "@/lib/platform/r2.server";
import { wordImageVariantKey } from "@/features/words/image";

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_FILENAME = /^[a-z0-9-]+\.[a-z0-9]{1,8}$/i;

async function handleGET(request: Request, slug: string, filename: string) {
  if (!SAFE_SLUG.test(slug) || !SAFE_FILENAME.test(filename)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const meta = await getWordMeta(slug);
  if (!meta || meta.visibility !== "private" || !(await canReadWordInServerContext(meta))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const widthValue = requestUrl.searchParams.get("width");
  const formatValue = requestUrl.searchParams.get("format");
  const width = widthValue ? Number(widthValue) : null;
  const hasVariantRequest = widthValue !== null || formatValue !== null;
  if (
    hasVariantRequest &&
    (!Number.isInteger(width) ||
      !width ||
      width < 1 ||
      width > 1600 ||
      !/^(avif|webp)$/.test(formatValue ?? ""))
  ) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const key = hasVariantRequest
    ? wordImageVariantKey(
        { scope: "word", slug },
        filename,
        width as number,
        formatValue as "avif" | "webp",
      )
    : `words/media/${slug}/${filename}`;
  const privateObject = await headObject(key, { scope: "private" });
  if (!privateObject.exists) {
    return Response.json({ error: "Not found" }, { status: 404 });
  } else {
    await deleteObject(key, { scope: "public" });
  }

  const location = await presignGetUrl(key, { scope: "private", expiresIn: 30 });
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": "private, no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export const Route = createFileRoute("/api/words/$slug/media/$filename")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGET(request, params.slug, params.filename),
    },
  },
});

export { handleGET as GET };
