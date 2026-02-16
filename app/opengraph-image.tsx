import { ImageResponse } from 'next/og';
import { SITE_BRAND } from '@/lib/shared/config';

export const alt = `${SITE_BRAND} — thoughts, stories, and things worth sharing`;
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#fafaf9',
          padding: 80,
        }}
      >
        {/* Brand */}
        <span
          style={{
            fontSize: 72,
            fontWeight: 700,
            color: '#1c1917',
            fontFamily: 'monospace',
            letterSpacing: '-0.04em',
          }}
        >
          {SITE_BRAND}
        </span>

        {/* Divider */}
        <div
          style={{
            width: 60,
            height: 2,
            backgroundColor: '#d6d3d1',
            marginTop: 32,
            marginBottom: 32,
          }}
        />

        {/* Tagline */}
        <span
          style={{
            fontSize: 24,
            color: '#a8a29e',
            fontFamily: 'monospace',
            letterSpacing: '0.02em',
          }}
        >
          thoughts, stories, and things worth sharing
        </span>

        {/* Slogan */}
        <span
          style={{
            fontSize: 18,
            color: '#d6d3d1',
            fontFamily: 'Georgia, serif',
            fontStyle: 'italic',
            marginTop: 20,
          }}
        >
          a social commentary on social commentary
        </span>
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
