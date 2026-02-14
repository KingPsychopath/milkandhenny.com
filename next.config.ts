import type { NextConfig } from "next";

const r2BaseUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? "";

const nextConfig: NextConfig = {
  async rewrites() {
    // Proxy R2 images through same-origin to avoid CORS issues with Canvas
    return r2BaseUrl
      ? [{ source: "/_img/:path*", destination: `${r2BaseUrl}/:path*` }]
      : [];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
