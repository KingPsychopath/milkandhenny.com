import { ImageResponse } from 'next/og';
import { getPostBySlug, getAllSlugs } from '@/lib/blog/reader';
import { SITE_BRAND } from '@/lib/shared/config';

export const alt = SITE_BRAND;
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function Image({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  const title = post?.title ?? SITE_BRAND;
  const subtitle = post?.subtitle;
  const date = post
    ? new Date(post.date + 'T00:00:00').toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '';

  /** Truncate long titles so they don't overflow the card */
  const displayTitle = title.length > 80 ? title.slice(0, 77) + '...' : title;

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#fafaf9',
          padding: 80,
        }}
      >
        {/* Top: brand + date */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: '#1c1917',
              fontFamily: 'monospace',
              letterSpacing: '-0.03em',
            }}
          >
            {SITE_BRAND}
          </span>
          <span
            style={{
              fontSize: 18,
              color: '#a8a29e',
              fontFamily: 'monospace',
            }}
          >
            {date}
          </span>
        </div>

        {/* Center: title + subtitle */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            flex: 1,
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              fontSize: subtitle ? 52 : 58,
              fontWeight: 700,
              color: '#1c1917',
              fontFamily: 'Georgia, serif',
              lineHeight: 1.15,
              letterSpacing: '-0.02em',
            }}
          >
            {displayTitle}
          </span>
          {subtitle && (
            <span
              style={{
                fontSize: 26,
                color: '#78716c',
                fontFamily: 'Georgia, serif',
                lineHeight: 1.4,
              }}
            >
              {subtitle}
            </span>
          )}
        </div>

        {/* Bottom: read prompt */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span
            style={{
              fontSize: 16,
              color: '#a8a29e',
              fontFamily: 'monospace',
              letterSpacing: '0.05em',
            }}
          >
            read on {SITE_BRAND} →
          </span>
          <div
            style={{
              width: 40,
              height: 2,
              backgroundColor: '#d6d3d1',
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

