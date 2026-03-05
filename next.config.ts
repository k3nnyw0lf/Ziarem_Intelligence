import type { NextConfig } from "next";

/** Hostinger: standalone Node server for API routes (webhooks). */
const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  images: {
    remotePatterns: [{ hostname: "ziarem.com" }],
  },
};

export default nextConfig;
