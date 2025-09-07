import type { NextConfig } from "next";

// SSR (Route Handlers 有効) モード: output:'export' を削除し動的処理復活
// Azure Static Web Apps Standard プランで Next.js SSR ランタイムを利用
const nextConfig: NextConfig = {
  images: { unoptimized: true },
  // 必要なら experimental オプション等ここに追加
};

export default nextConfig;
