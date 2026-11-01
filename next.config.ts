import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `npm test` builds separately, so it can run while the dev server is up.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // The badge covers the sidebar collapse button or form buttons, wherever it sits.
  devIndicators: false,
};

export default nextConfig;
