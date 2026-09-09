import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the Next.js API routes to proxy to the local FastAPI server
  async rewrites() {
    return [];
  },
};

export default nextConfig;
