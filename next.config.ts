import type { NextConfig } from "next";

// Azure Static Web Apps Free でのホスティング向けに静的エクスポートを有効化
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
