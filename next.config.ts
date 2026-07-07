import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  serverExternalPackages: ['pdfjs-dist'],
  turbopack: {
    root: __dirname,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};
export default nextConfig;