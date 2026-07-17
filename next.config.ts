import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Electron loads the dev server in alpha; static export is a later packaging concern.
  reactStrictMode: true,
  // Electron uses 127.0.0.1 while Next prints localhost — silence cross-origin /_next/* warnings.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
