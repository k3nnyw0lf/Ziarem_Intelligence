import type { NextConfig } from "next";

/** Hostinger: standalone Node server for API routes (webhooks). */
const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  swcMinify: true,
  images: {
    domains: ["ziarem.com"],
  },
  experimental: {
    serverActions: true,
  },
};

export default nextConfig;
