import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `npm test` builds separately, so it can run while the dev server is up.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // The badge covers the sidebar collapse button or form buttons, wherever it sits.
  devIndicators: false,
  // These read font files and use Node features, so they run as plain Node packages.
  serverExternalPackages: ["pdf-lib", "@pdf-lib/fontkit"],
  experimental: {
    // Leaves room for form overhead around the 5 MB limit on document uploads.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
