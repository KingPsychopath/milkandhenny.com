import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export const alt = 'Milk & Henny - First Ever Birthday';
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
          backgroundColor: '#0a0a0a',
          backgroundImage: 'radial-gradient(circle at 50% 50%, #1c1917 0%, #0a0a0a 70%)',
        }}
      >
        {/* Logo circle with M */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 200,
            height: 200,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #fbbf24 0%, #d97706 100%)',
            marginBottom: 40,
            boxShadow: '0 25px 50px -12px rgba(251, 191, 36, 0.4)',
          }}
        >
          <span
            style={{
              fontSize: 120,
              fontWeight: 700,
              color: '#18181b',
              fontFamily: 'Georgia, serif',
            }}
          >
            M
          </span>
        </div>

        {/* Title */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <span
            style={{
              fontSize: 72,
              fontWeight: 700,
              color: 'white',
              letterSpacing: '-0.02em',
            }}
          >
            Milk & Henny
          </span>
          <span
            style={{
              fontSize: 32,
              color: '#fbbf24',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              marginTop: 16,
            }}
          >
            First Ever Birthday
          </span>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}

