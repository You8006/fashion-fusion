import type { NextConfig } from "next";

// SSR (Route Handlers 有効) モード: output:'standalone' で SWA 対応
// Azure Static Web Apps Standard プランで Next.js SSR ランタイムを利用
const nextConfig: NextConfig = {
  output: 'standalone',
  images: { unoptimized: true },
};

export default nextConfig;
