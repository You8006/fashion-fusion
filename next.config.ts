import type { NextConfig } from "next";

// SSR / Route Handlers を有効にするため static export を解除
// (Azure Static Web Apps で Next.js SSR ランタイムを使用)
const nextConfig: NextConfig = {
  images: { unoptimized: true },
};

export default nextConfig;
