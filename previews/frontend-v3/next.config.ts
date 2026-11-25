import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
const distDir = process.env.SANSPHASE_V3_DIST_DIR || undefined;
const releaseId = /^\.next-release-([a-f0-9]{16}|[a-f0-9]{24})$/.exec(distDir ?? "")?.[1];
if (distDir && !releaseId) throw new Error("Invalid SANSPHASE_V3_DIST_DIR");

const nextConfig: NextConfig = {
  ...(distDir ? { distDir } : {}),
  // The existing shared static root outlives the selected app version.
  ...(releaseId?.length === 24 ? { assetPrefix: `/assets/site/${releaseId}` } : {}),
  turbopack: { root: __dirname },
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "github.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "opengraph.githubassets.com" },
      // Admin uploads (post covers, inline images, project screenshots).
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/media/**" },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
