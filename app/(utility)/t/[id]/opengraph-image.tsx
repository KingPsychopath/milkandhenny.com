/**
 * Runtime-generated OG image for transfer share links (/t/[id]).
 *
 * Cost & behaviour:
 * - Generated on demand when a crawler or share dialog requests this image URL.
 * - One serverless run per first request per transfer ID; response is cached
 *   (Cache-Control: 24h). Repeat requests for the same transfer reuse the cache.
 * - Not built at deploy time (transfers live in Redis). To avoid runtime cost,
 *   delete this file; Next.js will use the default site OG image
 *   (app/opengraph-image.tsx) for /t/[id] with the page's title and description.
 */
import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { getTransfer } from "@/lib/transfers/store";
import { SITE_BRAND } from "@/lib/shared/config";

export const alt = "Transfer shared via milk & henny";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function Image({ params }: Props) {
  const { id } = await params;
  const transfer = await getTransfer(id);

  if (!transfer) {
    return new NextResponse(null, { status: 404 });
  }

  const fileLabel =
    transfer.files.length === 1 ? "1 file" : `${transfer.files.length} files`;
  const displayTitle =
    transfer.title.length > 60
      ? transfer.title.slice(0, 57) + "..."
      : transfer.title;

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#fafaf9",
          padding: 80,
        }}
      >
        {/* Top: brand + file count */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "#1c1917",
              fontFamily: "monospace",
              letterSpacing: "-0.03em",
            }}
          >
            {SITE_BRAND}
          </span>
          <span
            style={{
              fontSize: 18,
              color: "#a8a29e",
              fontFamily: "monospace",
            }}
          >
            {fileLabel}
          </span>
        </div>

        {/* Center: transfer title */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            flex: 1,
            justifyContent: "center",
          }}
        >
          <span
            style={{
              fontSize: 48,
              fontWeight: 700,
              color: "#1c1917",
              fontFamily: "Georgia, serif",
              lineHeight: 1.2,
              letterSpacing: "-0.02em",
            }}
          >
            {displayTitle}
          </span>
          <span
            style={{
              fontSize: 24,
              color: "#78716c",
              fontFamily: "Georgia, serif",
            }}
          >
            shared via {SITE_BRAND}
          </span>
        </div>

        {/* Bottom: prompt */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 16,
              color: "#a8a29e",
              fontFamily: "monospace",
              letterSpacing: "0.05em",
            }}
          >
            view transfer →
          </span>
          <div
            style={{
              width: 40,
              height: 2,
              backgroundColor: "#d6d3d1",
            }}
          />
        </div>
      </div>
    ),
    {
      ...size,
      headers: {
        "Cache-Control": "public, s-maxage=86400, max-age=86400",
      },
    }
  );
}
